"""Moving an asset to a status, and who hears about it.

The first half is pure: given a status's rule and the facts about an asset,
it decides the recipients and the channel each gets. It has no database so it
can be tested as a table of cases. The second half loads those facts, writes
the change, and hands the mail and the live event off once it is committed.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Callable, Collection, Iterable, Mapping

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..config import settings
from ..models.activity import ActivityAction, ActivityLog, Notification, NotificationType
from ..models.asset import Asset, AssetStatus
from ..models.pipeline import AssetStatusDef, AssetStatusNotifyRole, PipelineRole, PipelineRoleAssignment
from ..models.project import ProjectMember
from ..models.user import User, UserStatus
from ..services import event_service
from ..services.permissions import can_access_asset
from ..tasks.celery_app import send_task_safe
from ..tasks.email_tasks import send_bulk_status_change_email, send_status_change_email

# The event the project stream carries when an asset's status changes.
STATUS_EVENT = "asset_status_updated"
# The key in `user.preferences["notifications"]` this honours.
PREFERENCE_KEY = "status_updates"


# ─── Pure part ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class StatusRule:
    notify_creator: bool
    notify_assignee: bool
    role_ids: frozenset[uuid.UUID]


@dataclass(frozen=True)
class Recipient:
    user_id: uuid.UUID
    in_app: bool
    email: bool
    # Why they are told: "creator", "assignee", "role:<role_id>". For tests and logs.
    reasons: tuple[str, ...]


def channels_for(preferences: Mapping | None) -> tuple[bool, bool]:
    """(in_app, email) for a user's `preferences`. The frontend stores
    `notifications.status_updates` as all_on / in_app / all_off; anything
    missing or unrecognised means both, as the setting defaults to."""
    notifications = preferences.get("notifications") if isinstance(preferences, Mapping) else None
    value = notifications.get(PREFERENCE_KEY) if isinstance(notifications, Mapping) else None
    if value == "in_app":
        return True, False
    if value == "all_off":
        return False, False
    return True, True


def merge_role_holders(
    role_ids: Iterable[uuid.UUID],
    project_defaults: Mapping[uuid.UUID, Collection[uuid.UUID]],
    asset_overrides: Mapping[uuid.UUID, Collection[uuid.UUID]],
) -> dict[uuid.UUID, frozenset[uuid.UUID]]:
    """Per role: its asset override when that has anyone in it, else the
    project default. An override replaces the default rather than adding to it."""
    merged: dict[uuid.UUID, frozenset[uuid.UUID]] = {}
    for role_id in role_ids:
        override = asset_overrides.get(role_id) or ()
        merged[role_id] = frozenset(override) if override else frozenset(project_defaults.get(role_id) or ())
    return merged


def resolve_status_recipients(
    rule: StatusRule,
    *,
    creator_id: uuid.UUID | None,
    assignee_id: uuid.UUID | None,
    actor_id: uuid.UUID,
    role_holders: Mapping[uuid.UUID, Collection[uuid.UUID]],
    can_access: Callable[[uuid.UUID], bool],
    preferences: Mapping[uuid.UUID, Mapping | None],
) -> list[Recipient]:
    """Who to tell, each once, in a stable order: creator, assignee, then the
    rule's roles and their holders sorted by id. The actor is never told, nor
    anyone who cannot see the asset or has switched these notifications off."""
    reasons: dict[uuid.UUID, list[str]] = {}

    def add(user_id: uuid.UUID | None, reason: str) -> None:
        if user_id is None or user_id == actor_id:
            return
        reasons.setdefault(user_id, []).append(reason)

    if rule.notify_creator:
        add(creator_id, "creator")
    if rule.notify_assignee:
        add(assignee_id, "assignee")
    for role_id in sorted(rule.role_ids, key=str):
        for user_id in sorted(role_holders.get(role_id, ()), key=str):
            add(user_id, f"role:{role_id}")

    recipients: list[Recipient] = []
    for user_id, why in reasons.items():
        if not can_access(user_id):
            continue
        in_app, email = channels_for(preferences.get(user_id))
        if not (in_app or email):
            continue
        recipients.append(Recipient(user_id=user_id, in_app=in_app, email=email, reasons=tuple(why)))
    return recipients


# ─── Database part ────────────────────────────────────────────────────────────

def live_statuses(db: Session) -> list[AssetStatusDef]:
    return (
        db.query(AssetStatusDef)
        .filter(AssetStatusDef.deleted_at.is_(None))
        .order_by(AssetStatusDef.position, AssetStatusDef.created_at)
        .all()
    )


def get_default_status(db: Session) -> AssetStatusDef | None:
    return db.query(AssetStatusDef).filter(
        AssetStatusDef.is_default.is_(True),
        AssetStatusDef.deleted_at.is_(None),
    ).first()


def get_live_status(db: Session, status_id: uuid.UUID) -> AssetStatusDef | None:
    return db.query(AssetStatusDef).filter(
        AssetStatusDef.id == status_id,
        AssetStatusDef.deleted_at.is_(None),
    ).first()


def notify_role_ids(db: Session, status_id: uuid.UUID) -> frozenset[uuid.UUID]:
    """The live roles a status notifies."""
    rows = (
        db.query(AssetStatusNotifyRole.role_id)
        .join(PipelineRole, PipelineRole.id == AssetStatusNotifyRole.role_id)
        .filter(AssetStatusNotifyRole.status_id == status_id, PipelineRole.deleted_at.is_(None))
        .all()
    )
    return frozenset(r[0] for r in rows)


def status_rule(db: Session, status: AssetStatusDef) -> StatusRule:
    return StatusRule(
        notify_creator=bool(status.notify_creator),
        notify_assignee=bool(status.notify_assignee),
        role_ids=notify_role_ids(db, status.id),
    )


def _active_user_ids(db: Session, user_ids: Collection[uuid.UUID]) -> set[uuid.UUID]:
    if not user_ids:
        return set()
    rows = db.query(User.id).filter(
        User.id.in_(list(user_ids)),
        User.deleted_at.is_(None),
        User.status != UserStatus.deactivated,
    ).all()
    return {r[0] for r in rows}


def load_role_holders(db: Session, asset: Asset, role_ids: Collection[uuid.UUID]) -> dict[uuid.UUID, frozenset[uuid.UUID]]:
    """Who holds each of `role_ids` for this asset: its overrides where there
    are any, the project's defaults otherwise. Deactivated and deleted users
    are left out as if they held nothing."""
    if not role_ids:
        return {}
    rows = db.query(PipelineRoleAssignment).filter(
        PipelineRoleAssignment.role_id.in_(list(role_ids)),
        PipelineRoleAssignment.project_id == asset.project_id,
        or_(PipelineRoleAssignment.asset_id.is_(None), PipelineRoleAssignment.asset_id == asset.id),
    ).all()
    active = _active_user_ids(db, {r.user_id for r in rows})
    defaults: dict[uuid.UUID, set[uuid.UUID]] = {}
    overrides: dict[uuid.UUID, set[uuid.UUID]] = {}
    for row in rows:
        if row.user_id not in active:
            continue
        bucket = overrides if row.asset_id is not None else defaults
        bucket.setdefault(row.role_id, set()).add(row.user_id)
    return merge_role_holders(role_ids, defaults, overrides)


def reset_asset_status_for_new_version(db: Session, asset: Asset, actor: User) -> bool:
    """A new version puts `asset` back at the instance default status.

    Silent by design: the activity log records it and the project stream
    carries it, but nobody is notified. The move that matters comes next,
    when the editor puts the version in its proper status, and that one tells
    the people the status names. Returns False, having done nothing, when
    there is no default or the asset is already there.
    """
    default = get_default_status(db)
    if default is None or asset.status_id == default.id:
        return False
    previous = get_live_status(db, asset.status_id) if asset.status_id else None
    _apply_status(db, asset, default, actor, previous, reason="new_version")
    db.commit()
    _publish(asset, default, actor)
    return True


def asset_link(asset: Asset) -> str:
    return f"{settings.frontend_url}/projects/{asset.project_id}/assets/{asset.id}"


def project_status_link(project_id: uuid.UUID, status_id: uuid.UUID) -> str:
    """The project page filtered on a status: where a grouped notification points."""
    return f"{settings.frontend_url}/projects/{project_id}?status={status_id}"


# ─── The pieces a single and a bulk move share ────────────────────────────────

def _mirror_legacy(asset: Asset, status: AssetStatusDef) -> None:
    if status.legacy_key:
        try:
            asset.status = AssetStatus(status.legacy_key)
        except ValueError:
            pass  # a key the enum does not know: leave the legacy column alone


def _apply_status(
    db: Session, asset: Asset, new_status: AssetStatusDef, actor: User,
    previous: AssetStatusDef | None, *, reason: str | None = None,
) -> None:
    """Write the move and its activity row; no commit, no one told."""
    asset.status_id = new_status.id
    _mirror_legacy(asset, new_status)
    payload = {
        "from_status_id": str(previous.id) if previous else None,
        "from_status_name": previous.name if previous else None,
        "to_status_id": str(new_status.id),
        "to_status_name": new_status.name,
    }
    if reason:
        payload["reason"] = reason
    db.add(ActivityLog(
        user_id=actor.id,
        project_id=asset.project_id,
        asset_id=asset.id,
        action=ActivityAction.status_changed,
        payload=payload,
    ))


def _candidate_ids(asset: Asset, holders: Mapping[uuid.UUID, Collection[uuid.UUID]], actor_id: uuid.UUID) -> set[uuid.UUID]:
    ids = {asset.created_by, asset.assignee_id} | {u for users in holders.values() for u in users}
    ids.discard(None)
    ids.discard(actor_id)
    return ids


def _load_users(db: Session, ids: Collection[uuid.UUID]) -> dict[uuid.UUID, User]:
    if not ids:
        return {}
    return {u.id: u for u in db.query(User).filter(User.id.in_(list(ids)), User.deleted_at.is_(None)).all()}


def _recipients_for(
    db: Session, asset: Asset, rule: StatusRule, actor: User,
    holders: Mapping[uuid.UUID, Collection[uuid.UUID]], users: Mapping[uuid.UUID, User],
    can_access: Callable[[uuid.UUID], bool] | None = None,
) -> list[Recipient]:
    return resolve_status_recipients(
        rule,
        creator_id=asset.created_by,
        assignee_id=asset.assignee_id,
        actor_id=actor.id,
        role_holders=holders,
        can_access=can_access or (lambda uid: uid in users and can_access_asset(db, asset, users[uid])),
        preferences={uid: u.preferences for uid, u in users.items()},
    )


def _status_payload(new_status: AssetStatusDef, from_name: str | None) -> dict:
    return {
        "status_id": str(new_status.id),
        "status_name": new_status.name,
        "status_color": new_status.color,
        "from_status_name": from_name,
    }


def _publish(asset: Asset, new_status: AssetStatusDef, actor: User) -> bool:
    return event_service.publish_sync(asset.project_id, STATUS_EVENT, {
        "asset_id": str(asset.id),
        "status_id": str(new_status.id),
        "user_id": str(actor.id),
    })


def change_asset_status(db: Session, asset: Asset, new_status: AssetStatusDef, actor: User) -> bool:
    """Move `asset` to `new_status` on behalf of `actor`.

    Returns False, having done nothing, when the asset is already there.
    Otherwise writes the change, its activity row and the in-app
    notifications in one commit, and only then dispatches the emails and the
    live event -- a mail about a change that then failed to commit would be a
    lie, which is the order routers/approvals.py gets wrong.
    """
    if asset.status_id == new_status.id:
        return False

    previous = get_live_status(db, asset.status_id) if asset.status_id else None
    from_name = previous.name if previous else None
    _apply_status(db, asset, new_status, actor, previous)

    rule = status_rule(db, new_status)
    holders = load_role_holders(db, asset, rule.role_ids)
    users = _load_users(db, _candidate_ids(asset, holders, actor.id))
    recipients = _recipients_for(db, asset, rule, actor, holders, users)

    payload = _status_payload(new_status, from_name)
    for recipient in recipients:
        if recipient.in_app:
            db.add(Notification(
                user_id=recipient.user_id,
                type=NotificationType.status_change,
                asset_id=asset.id,
                actor_id=actor.id,
                payload=payload,
            ))
    db.commit()

    link = asset_link(asset)
    for recipient in recipients:
        if recipient.email:
            send_task_safe(
                send_status_change_email,
                to_email=users[recipient.user_id].email,
                actor_name=actor.name,
                asset_name=asset.name,
                status_name=new_status.name,
                status_color=new_status.color,
                from_status_name=from_name,
                asset_link=link,
            )
    _publish(asset, new_status, actor)
    return True


# How many asset names a grouped notification and email carry; the rest is "and N more".
BULK_NAMES_SHOWN = 5


def change_assets_status(db: Session, assets: list[Asset], new_status: AssetStatusDef, actor: User) -> list[Asset]:
    """Move several assets of one project to `new_status` in one commit, on
    behalf of `actor`. Returns the assets that moved; those already there are
    left alone, and when none moves nothing is written, sent or published.

    Each person the status names hears once: one in-app notification and one
    email naming all of their assets (someone concerned with a single one of
    them gets the ordinary single-asset message), and the live event goes out
    once per asset, as the single move sends it.
    """
    moving = [a for a in assets if a.status_id != new_status.id]
    if not moving:
        return []
    project_id = moving[0].project_id

    previous_ids = {a.status_id for a in moving if a.status_id}
    previous_by_id: dict[uuid.UUID, AssetStatusDef] = {}
    if previous_ids:
        previous_by_id = {
            s.id: s for s in db.query(AssetStatusDef).filter(
                AssetStatusDef.id.in_(list(previous_ids)), AssetStatusDef.deleted_at.is_(None),
            ).all()
        }
    from_name_of: dict[uuid.UUID, str | None] = {}
    for a in moving:
        previous = previous_by_id.get(a.status_id) if a.status_id else None
        from_name_of[a.id] = previous.name if previous else None
        _apply_status(db, a, new_status, actor, previous)

    rule = status_rule(db, new_status)
    holders_of = {a.id: load_role_holders(db, a, rule.role_ids) for a in moving}
    candidates: set[uuid.UUID] = set()
    for a in moving:
        candidates |= _candidate_ids(a, holders_of[a.id], actor.id)
    users = _load_users(db, candidates)
    # A member reaches every asset of the project, so one membership query
    # answers most access checks; the rest fall back to the full check.
    member_ids = {
        r[0] for r in db.query(ProjectMember.user_id).filter(
            ProjectMember.project_id == project_id, ProjectMember.deleted_at.is_(None),
        ).all()
    } if users else set()

    per_user: dict[uuid.UUID, list[Asset]] = {}
    channels: dict[uuid.UUID, Recipient] = {}
    for a in moving:
        can_access = lambda uid, a=a: uid in users and (uid in member_ids or can_access_asset(db, a, users[uid]))
        for r in _recipients_for(db, a, rule, actor, holders_of[a.id], users, can_access):
            per_user.setdefault(r.user_id, []).append(a)
            channels.setdefault(r.user_id, r)

    for user_id, theirs in per_user.items():
        if not channels[user_id].in_app:
            continue
        if len(theirs) == 1:
            payload = _status_payload(new_status, from_name_of[theirs[0].id])
        else:
            payload = {
                **_status_payload(new_status, None),
                "asset_count": len(theirs),
                "asset_ids": [str(a.id) for a in theirs],
                "asset_names": [a.name for a in theirs[:BULK_NAMES_SHOWN]],
                "project_id": str(project_id),
            }
        db.add(Notification(
            user_id=user_id,
            type=NotificationType.status_change,
            asset_id=theirs[0].id,
            actor_id=actor.id,
            payload=payload,
        ))
    db.commit()

    for user_id, theirs in per_user.items():
        if not channels[user_id].email:
            continue
        if len(theirs) == 1:
            one = theirs[0]
            send_task_safe(
                send_status_change_email,
                to_email=users[user_id].email,
                actor_name=actor.name,
                asset_name=one.name,
                status_name=new_status.name,
                status_color=new_status.color,
                from_status_name=from_name_of[one.id],
                asset_link=asset_link(one),
            )
        else:
            send_task_safe(
                send_bulk_status_change_email,
                to_email=users[user_id].email,
                actor_name=actor.name,
                asset_count=len(theirs),
                asset_names=[a.name for a in theirs[:BULK_NAMES_SHOWN]],
                status_name=new_status.name,
                status_color=new_status.color,
                project_link=project_status_link(project_id, new_status.id),
            )
    for a in moving:
        if not _publish(a, new_status, actor):
            break  # the broker is down: the rest would fail the same way
    return moving
