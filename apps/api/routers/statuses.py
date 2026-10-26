"""Asset statuses, pipeline roles, and who holds them.

The status list and the roles are instance-wide and admin-managed. Who holds
a role is a project matter (its owner sets the defaults) with per-asset
overrides (editor and up). Moving an asset between statuses takes the
reviewer role, as approving does.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.asset import Asset, AssetStatus
from ..models.pipeline import AssetStatusDef, AssetStatusNotifyRole, PipelineRole, PipelineRoleAssignment
from ..models.project import ProjectMember, ProjectRole
from ..models.user import User
from ..routers.users import require_admin
from ..schemas.asset import AssetResponse
from ..schemas.pipeline import (
    AssetStatusChange, PipelineRoleCreate, PipelineRoleResponse, PipelineRoleUpdate,
    RoleAssignmentEntry, RoleAssignmentsPut, RoleAssignmentsResponse,
    StatusCreate, StatusReorder, StatusResponse, StatusUpdate,
)
from ..services.permissions import (
    require_asset_access, require_live_project, require_project_role, require_project_visible,
)
from ..services.status_notifications import (
    change_asset_status, get_default_status, get_live_status, live_statuses,
)
from .assets import _build_asset_response

router = APIRouter(tags=["statuses"])


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _status_or_404(db: Session, status_id: uuid.UUID) -> AssetStatusDef:
    row = get_live_status(db, status_id)
    if not row:
        raise HTTPException(status_code=404, detail="Status not found")
    return row


def _role_or_404(db: Session, role_id: uuid.UUID) -> PipelineRole:
    row = db.query(PipelineRole).filter(PipelineRole.id == role_id, PipelineRole.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Pipeline role not found")
    return row


def _live_role_ids(db: Session, role_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """The subset of `role_ids` that names a live role; 404 if any does not."""
    wanted = set(role_ids)
    if not wanted:
        return set()
    found = {r[0] for r in db.query(PipelineRole.id).filter(
        PipelineRole.id.in_(list(wanted)), PipelineRole.deleted_at.is_(None),
    ).all()}
    missing = wanted - found
    if missing:
        raise HTTPException(status_code=404, detail="Pipeline role not found")
    return found


def _notify_map(db: Session, status_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
    out: dict[uuid.UUID, list[uuid.UUID]] = {sid: [] for sid in status_ids}
    if not status_ids:
        return out
    rows = (
        db.query(AssetStatusNotifyRole.status_id, AssetStatusNotifyRole.role_id)
        .join(PipelineRole, PipelineRole.id == AssetStatusNotifyRole.role_id)
        .filter(AssetStatusNotifyRole.status_id.in_(status_ids), PipelineRole.deleted_at.is_(None))
        .all()
    )
    for sid, rid in rows:
        out.setdefault(sid, []).append(rid)
    return out


def _status_response(row: AssetStatusDef, role_ids: list[uuid.UUID]) -> StatusResponse:
    return StatusResponse(
        id=row.id, name=row.name, color=row.color, position=row.position,
        is_default=bool(row.is_default), notify_creator=bool(row.notify_creator),
        notify_assignee=bool(row.notify_assignee), notify_role_ids=sorted(role_ids, key=str),
        legacy_key=row.legacy_key,
    )


def _replace_notify_roles(db: Session, status_id: uuid.UUID, role_ids: set[uuid.UUID]) -> None:
    db.query(AssetStatusNotifyRole).filter(AssetStatusNotifyRole.status_id == status_id).delete(synchronize_session=False)
    for rid in role_ids:
        db.add(AssetStatusNotifyRole(status_id=status_id, role_id=rid))


def _clear_default(db: Session, except_id: uuid.UUID | None) -> None:
    q = db.query(AssetStatusDef).filter(AssetStatusDef.is_default.is_(True), AssetStatusDef.deleted_at.is_(None))
    if except_id is not None:
        q = q.filter(AssetStatusDef.id != except_id)
    q.update({"is_default": False}, synchronize_session=False)


def _commit_or_conflict(db: Session, detail: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=detail)


# ─── Statuses ─────────────────────────────────────────────────────────────────

@router.get("/statuses", response_model=list[StatusResponse])
def list_statuses(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = live_statuses(db)
    roles = _notify_map(db, [r.id for r in rows])
    return [_status_response(r, roles.get(r.id, [])) for r in rows]


@router.post("/statuses", response_model=StatusResponse, status_code=status.HTTP_201_CREATED)
def create_status(body: StatusCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    role_ids = _live_role_ids(db, body.notify_role_ids)
    existing = live_statuses(db)
    position = max((r.position for r in existing), default=-1) + 1
    if body.is_default:
        _clear_default(db, None)
    row = AssetStatusDef(
        id=uuid.uuid4(),
        name=body.name, color=body.color.lower(), position=position, is_default=body.is_default,
        notify_creator=body.notify_creator, notify_assignee=body.notify_assignee,
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A status with that name already exists")
    _replace_notify_roles(db, row.id, role_ids)
    _commit_or_conflict(db, "A status with that name already exists")
    db.refresh(row)
    return _status_response(row, sorted(role_ids, key=str))


@router.patch("/statuses/{status_id}", response_model=StatusResponse)
def update_status(
    status_id: uuid.UUID, body: StatusUpdate,
    db: Session = Depends(get_db), current_user: User = Depends(require_admin),
):
    row = _status_or_404(db, status_id)
    fields = body.model_dump(exclude_unset=True)
    if fields.get("is_default") is False and row.is_default:
        raise HTTPException(status_code=409, detail="Mark another status as the default instead")
    role_ids = None
    if "notify_role_ids" in fields and fields["notify_role_ids"] is not None:
        role_ids = _live_role_ids(db, fields["notify_role_ids"])
    if fields.get("is_default") is True and not row.is_default:
        _clear_default(db, row.id)
        row.is_default = True
    for key in ("name", "notify_creator", "notify_assignee"):
        if fields.get(key) is not None:
            setattr(row, key, fields[key])
    if fields.get("color") is not None:
        row.color = fields["color"].lower()
    if role_ids is not None:
        _replace_notify_roles(db, row.id, role_ids)
    _commit_or_conflict(db, "A status with that name already exists")
    db.refresh(row)
    current = _notify_map(db, [row.id]).get(row.id, []) if role_ids is None else sorted(role_ids, key=str)
    return _status_response(row, current)


@router.put("/statuses/reorder", response_model=list[StatusResponse])
def reorder_statuses(body: StatusReorder, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    rows = live_statuses(db)
    by_id = {r.id: r for r in rows}
    if set(body.ids) != set(by_id) or len(body.ids) != len(by_id):
        raise HTTPException(status_code=400, detail="Reorder must list every status exactly once")
    for position, sid in enumerate(body.ids):
        by_id[sid].position = position
    db.commit()
    ordered = [by_id[sid] for sid in body.ids]
    roles = _notify_map(db, body.ids)
    return [_status_response(r, roles.get(r.id, [])) for r in ordered]


@router.delete("/statuses/{status_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_status(status_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    row = _status_or_404(db, status_id)
    if row.is_default:
        raise HTTPException(status_code=409, detail="The default status cannot be deleted; make another the default first")
    default = get_default_status(db)
    if default is None:
        raise HTTPException(status_code=409, detail="No default status to move this status's assets to")
    # Its assets go to the default, which is where a new asset would start.
    values: dict = {"status_id": default.id}
    if default.legacy_key:
        try:
            values["status"] = AssetStatus(default.legacy_key)
        except ValueError:
            pass
    db.query(Asset).filter(Asset.status_id == row.id).update(values, synchronize_session=False)
    db.query(AssetStatusNotifyRole).filter(AssetStatusNotifyRole.status_id == row.id).delete(synchronize_session=False)
    row.deleted_at = datetime.now(timezone.utc)
    db.commit()


# ─── Pipeline roles ───────────────────────────────────────────────────────────

@router.get("/pipeline-roles", response_model=list[PipelineRoleResponse])
def list_pipeline_roles(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(PipelineRole).filter(PipelineRole.deleted_at.is_(None)).order_by(PipelineRole.name).all()


@router.post("/pipeline-roles", response_model=PipelineRoleResponse, status_code=status.HTTP_201_CREATED)
def create_pipeline_role(body: PipelineRoleCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    row = PipelineRole(id=uuid.uuid4(), name=body.name)
    db.add(row)
    _commit_or_conflict(db, "A role with that name already exists")
    db.refresh(row)
    return row


@router.patch("/pipeline-roles/{role_id}", response_model=PipelineRoleResponse)
def update_pipeline_role(
    role_id: uuid.UUID, body: PipelineRoleUpdate,
    db: Session = Depends(get_db), current_user: User = Depends(require_admin),
):
    row = _role_or_404(db, role_id)
    row.name = body.name
    _commit_or_conflict(db, "A role with that name already exists")
    db.refresh(row)
    return row


@router.delete("/pipeline-roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pipeline_role(role_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    row = _role_or_404(db, role_id)
    db.query(PipelineRoleAssignment).filter(PipelineRoleAssignment.role_id == row.id).delete(synchronize_session=False)
    db.query(AssetStatusNotifyRole).filter(AssetStatusNotifyRole.role_id == row.id).delete(synchronize_session=False)
    row.deleted_at = datetime.now(timezone.utc)
    db.commit()


# ─── Who holds a role ─────────────────────────────────────────────────────────

def _entries(rows: list[PipelineRoleAssignment]) -> list[RoleAssignmentEntry]:
    grouped: dict[uuid.UUID, list[uuid.UUID]] = {}
    for r in rows:
        grouped.setdefault(r.role_id, []).append(r.user_id)
    return [
        RoleAssignmentEntry(role_id=rid, user_ids=sorted(uids, key=str))
        for rid, uids in sorted(grouped.items(), key=lambda kv: str(kv[0]))
    ]


def _validate_put(db: Session, project_id: uuid.UUID, body: RoleAssignmentsPut) -> list[tuple[uuid.UUID, uuid.UUID]]:
    """(role_id, user_id) pairs to write, each role and member checked."""
    _live_role_ids(db, [e.role_id for e in body.assignments])
    wanted_users = {uid for e in body.assignments for uid in e.user_ids}
    if wanted_users:
        members = {m[0] for m in db.query(ProjectMember.user_id).filter(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id.in_(list(wanted_users)),
            ProjectMember.deleted_at.is_(None),
        ).all()}
        if wanted_users - members:
            raise HTTPException(status_code=400, detail="Only project members can hold a pipeline role")
    pairs: list[tuple[uuid.UUID, uuid.UUID]] = []
    seen: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for entry in body.assignments:
        for uid in entry.user_ids:
            if (entry.role_id, uid) not in seen:
                seen.add((entry.role_id, uid))
                pairs.append((entry.role_id, uid))
    return pairs


@router.get("/projects/{project_id}/pipeline-assignments", response_model=RoleAssignmentsResponse)
def get_project_assignments(project_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_project_visible(db, project_id, current_user)
    rows = db.query(PipelineRoleAssignment).filter(
        PipelineRoleAssignment.project_id == project_id,
        PipelineRoleAssignment.asset_id.is_(None),
    ).all()
    return RoleAssignmentsResponse(project_defaults=_entries(rows))


@router.put("/projects/{project_id}/pipeline-assignments", response_model=RoleAssignmentsResponse)
def put_project_assignments(
    project_id: uuid.UUID, body: RoleAssignmentsPut,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    require_project_role(db, project_id, current_user, ProjectRole.owner)
    pairs = _validate_put(db, project_id, body)
    db.query(PipelineRoleAssignment).filter(
        PipelineRoleAssignment.project_id == project_id,
        PipelineRoleAssignment.asset_id.is_(None),
    ).delete(synchronize_session=False)
    for role_id, user_id in pairs:
        db.add(PipelineRoleAssignment(role_id=role_id, project_id=project_id, asset_id=None, user_id=user_id))
    db.commit()
    return get_project_assignments(project_id, db, current_user)


def _asset_or_404(db: Session, asset_id: uuid.UUID) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


@router.get("/assets/{asset_id}/pipeline-assignments", response_model=RoleAssignmentsResponse)
def get_asset_assignments(asset_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = _asset_or_404(db, asset_id)
    require_live_project(db, asset.project_id)
    require_asset_access(db, asset, current_user)
    rows = db.query(PipelineRoleAssignment).filter(
        PipelineRoleAssignment.project_id == asset.project_id,
        PipelineRoleAssignment.asset_id.is_(None),
    ).all()
    overrides = db.query(PipelineRoleAssignment).filter(PipelineRoleAssignment.asset_id == asset.id).all()
    return RoleAssignmentsResponse(project_defaults=_entries(rows), overrides=_entries(overrides))


@router.put("/assets/{asset_id}/pipeline-assignments", response_model=RoleAssignmentsResponse)
def put_asset_assignments(
    asset_id: uuid.UUID, body: RoleAssignmentsPut,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    asset = _asset_or_404(db, asset_id)
    require_project_role(db, asset.project_id, current_user, ProjectRole.editor)
    pairs = _validate_put(db, asset.project_id, body)
    db.query(PipelineRoleAssignment).filter(PipelineRoleAssignment.asset_id == asset.id).delete(synchronize_session=False)
    for role_id, user_id in pairs:
        db.add(PipelineRoleAssignment(role_id=role_id, project_id=asset.project_id, asset_id=asset.id, user_id=user_id))
    db.commit()
    return get_asset_assignments(asset_id, db, current_user)


# ─── Moving an asset ──────────────────────────────────────────────────────────

@router.put("/assets/{asset_id}/status", response_model=AssetResponse)
def set_asset_status(
    asset_id: uuid.UUID, body: AssetStatusChange,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    asset = _asset_or_404(db, asset_id)
    require_project_role(db, asset.project_id, current_user, ProjectRole.reviewer)
    new_status = _status_or_404(db, body.status_id)
    change_asset_status(db, asset, new_status, current_user)
    return _build_asset_response(asset, db)
