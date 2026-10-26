"""Pipeline role assignments and the migration's seed, against a real Postgres.

The partial unique indexes and the seeded rows are schema facts the mock
session cannot stand in for, so these use `real_db` (rolled back afterwards).
"""
import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from apps.api.models.asset import Asset, AssetType
from apps.api.models.pipeline import AssetStatusDef, PipelineRole, PipelineRoleAssignment
from apps.api.models.project import Project, ProjectMember, ProjectRole, ProjectType
from apps.api.models.user import User, UserStatus
from apps.api.services.status_notifications import get_default_status, load_role_holders


def _user(db, name, status=UserStatus.active):
    u = User(email=f"{name}-{uuid.uuid4().hex[:8]}@t.local", name=name, status=status)
    db.add(u); db.flush()
    return u


def _world(db):
    owner, pm, pm2, editor = (_user(db, n) for n in ("owner", "pm", "pm2", "editor"))
    gone = _user(db, "gone", status=UserStatus.deactivated)
    project = Project(name="P", project_type=ProjectType.team, created_by=owner.id)
    db.add(project); db.flush()
    for u in (owner, pm, pm2, editor, gone):
        db.add(ProjectMember(project_id=project.id, user_id=u.id, role=ProjectRole.editor))
    asset = Asset(project_id=project.id, name="A", asset_type=AssetType.video, created_by=owner.id)
    db.add(asset); db.flush()
    role_pm = PipelineRole(name=f"PM-{uuid.uuid4().hex[:6]}")
    role_ed = PipelineRole(name=f"Editor-{uuid.uuid4().hex[:6]}")
    db.add_all([role_pm, role_ed]); db.flush()
    return owner, pm, pm2, editor, gone, project, asset, role_pm, role_ed


def test_migration_seeds_the_pipeline_with_one_default(real_db):
    rows = real_db.query(AssetStatusDef).filter(AssetStatusDef.deleted_at.is_(None)).order_by(AssetStatusDef.position).all()
    names = [r.name for r in rows]
    for expected in ("No Status", "Needs PM Review", "Approved", "Rejected"):
        assert expected in names
    defaults = [r for r in rows if r.is_default]
    assert len(defaults) == 1
    assert get_default_status(real_db).id == defaults[0].id
    legacy = {r.legacy_key for r in rows if r.legacy_key}
    assert legacy == {"draft", "approved", "rejected"}
    assert len(real_db.query(PipelineRole).filter(PipelineRole.deleted_at.is_(None)).all()) >= 4


def test_a_project_default_cannot_be_held_twice(real_db):
    owner, pm, *_rest, project, asset, role_pm, role_ed = _world(real_db)
    real_db.add(PipelineRoleAssignment(role_id=role_pm.id, project_id=project.id, asset_id=None, user_id=pm.id))
    real_db.flush()
    with pytest.raises(IntegrityError):
        with real_db.begin_nested():
            real_db.add(PipelineRoleAssignment(role_id=role_pm.id, project_id=project.id, asset_id=None, user_id=pm.id))
            real_db.flush()


def test_an_asset_override_cannot_be_held_twice_but_may_match_the_default(real_db):
    owner, pm, *_rest, project, asset, role_pm, role_ed = _world(real_db)
    real_db.add(PipelineRoleAssignment(role_id=role_pm.id, project_id=project.id, asset_id=None, user_id=pm.id))
    # Same role, same person, but for this asset: a different row, allowed.
    real_db.add(PipelineRoleAssignment(role_id=role_pm.id, project_id=project.id, asset_id=asset.id, user_id=pm.id))
    real_db.flush()
    with pytest.raises(IntegrityError):
        with real_db.begin_nested():
            real_db.add(PipelineRoleAssignment(role_id=role_pm.id, project_id=project.id, asset_id=asset.id, user_id=pm.id))
            real_db.flush()


def test_load_role_holders_prefers_the_override_and_drops_deactivated_users(real_db):
    owner, pm, pm2, editor, gone, project, asset, role_pm, role_ed = _world(real_db)
    real_db.add_all([
        PipelineRoleAssignment(role_id=role_pm.id, project_id=project.id, asset_id=None, user_id=pm.id),
        PipelineRoleAssignment(role_id=role_pm.id, project_id=project.id, asset_id=asset.id, user_id=pm2.id),
        PipelineRoleAssignment(role_id=role_ed.id, project_id=project.id, asset_id=None, user_id=editor.id),
        PipelineRoleAssignment(role_id=role_ed.id, project_id=project.id, asset_id=None, user_id=gone.id),
    ])
    real_db.flush()

    holders = load_role_holders(real_db, asset, [role_pm.id, role_ed.id])

    assert holders[role_pm.id] == frozenset({pm2.id})      # the override, not the default
    assert holders[role_ed.id] == frozenset({editor.id})   # the default, minus the deactivated holder

    other = Asset(project_id=project.id, name="B", asset_type=AssetType.video, created_by=owner.id)
    real_db.add(other); real_db.flush()
    assert load_role_holders(real_db, other, [role_pm.id])[role_pm.id] == frozenset({pm.id})


def test_put_project_assignments_requires_the_owner(client, auth_headers, mock_db, test_user, monkeypatch):
    from fastapi import HTTPException
    import apps.api.routers.statuses as statuses_module

    def refuse(db, pid, u, r):
        raise HTTPException(status_code=403, detail="Requires owner role or higher")
    monkeypatch.setattr(statuses_module, "require_project_role", refuse)

    resp = client.put(
        f"/projects/{uuid.uuid4()}/pipeline-assignments", headers=auth_headers,
        json={"assignments": [{"role_id": str(uuid.uuid4()), "user_ids": [str(uuid.uuid4())]}]},
    )
    assert resp.status_code == 403
    mock_db.commit.assert_not_called()
