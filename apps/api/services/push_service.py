"""Web Push: turning an in-app notification into something a phone shows.

Push is a mirror of the in-app notification, delivered to every device the
user turned it on in. The words and the destination are the ones the web
app's drawer and Notifications page use (apps/web/components/layout/
notification-text.tsx, apps/web/lib/notification-target.ts): a phone that
shows "Marco moved Spot 30s to Approved" and opens the asset on tap is
showing the same thing the bell would.

Two halves. `notify_push` is what the request path calls, once, after the
commit that wrote the rows: it only queues one task per notification. The
rest is what the task calls to decide and build: the preference the type
answers to, whether the user allowed it, the text and the URL.
"""
import logging
import uuid
from collections.abc import Iterable, Mapping
from typing import Optional

from sqlalchemy.orm import Session

from ..config import settings
from ..models.activity import Notification, NotificationType
from ..models.asset import Asset
from ..models.comment import Comment
from ..models.user import GuestUser, User
from ..tasks.celery_app import send_task_safe

log = logging.getLogger("push")

# The key in `user.preferences["notifications"]` each type answers to; `None`
# means always. These are the keys Settings → Notifications already saves.
# A reply to the user's own comment answers to `comment_replies` instead of
# `general_comments` (decided per row by `preference_key`).
PREFERENCE_KEY_FOR: dict[NotificationType, Optional[str]] = {
    NotificationType.status_change: "status_updates",
    NotificationType.mention: "mentions",
    NotificationType.comment: "general_comments",
    NotificationType.assignment: "assigned_to_you",
    NotificationType.approval: None,
    NotificationType.delivery: None,
    NotificationType.due_soon: None,
}


def preference_key(notification: Notification, comment: Optional[Comment]) -> Optional[str]:
    if notification.type == NotificationType.comment and comment is not None and comment.parent_id is not None:
        return "comment_replies"
    return PREFERENCE_KEY_FOR.get(notification.type)


def push_allowed(preferences: Mapping | None, key: Optional[str]) -> bool:
    """Push follows the in-app channel: only `all_off` silences it. Missing or
    unrecognised values mean on, as the setting defaults to (`channels_for`
    in status_notifications.py reads the same values the same way)."""
    if key is None:
        return True
    notifications = preferences.get("notifications") if isinstance(preferences, Mapping) else None
    value = notifications.get(key) if isinstance(notifications, Mapping) else None
    return value != "all_off"


def notification_url(notification: Notification, asset: Optional[Asset]) -> Optional[str]:
    """Where a tap goes, in the order the web app's `notificationTarget` uses:
    a finished Drive delivery opens the file on Drive; a grouped status change
    opens the project filtered on that status; anything else opens the asset,
    with the comment focused when there is one."""
    payload = notification.payload if isinstance(notification.payload, Mapping) else {}
    if notification.type == NotificationType.delivery and payload.get("status") == "done" and payload.get("web_view_link"):
        return str(payload["web_view_link"])
    if notification.type == NotificationType.status_change and payload.get("asset_count") and payload.get("project_id") and payload.get("status_id"):
        return f"{settings.frontend_url}/projects/{payload['project_id']}?status={payload['status_id']}"
    if asset is None:
        return None
    url = f"{settings.frontend_url}/projects/{asset.project_id}/assets/{asset.id}"
    if notification.comment_id:
        url += f"?commentId={notification.comment_id}"
    return url


def _actor_name(db: Session, notification: Notification, comment: Optional[Comment]) -> str:
    """The same resolution as GET /me/notifications: the comment's author, a
    share-link guest, then the actor the row names. "Someone" when none."""
    if comment is not None:
        if comment.author_id:
            author = db.query(User).filter(User.id == comment.author_id).first()
            if author:
                return author.name
        elif comment.guest_author_id:
            guest = db.query(GuestUser).filter(GuestUser.id == comment.guest_author_id).first()
            if guest:
                return f"{guest.name} (guest)"
    if notification.actor_id:
        actor = db.query(User).filter(User.id == notification.actor_id).first()
        if actor:
            return actor.name
    return "Someone"


def notification_text(notification: Notification, asset_name: Optional[str], actor: str, comment_preview: Optional[str]) -> tuple[str, str]:
    """(title, body): the drawer's wording, verbatim."""
    asset = asset_name or "an asset"
    payload = notification.payload if isinstance(notification.payload, Mapping) else {}
    t = notification.type
    if t == NotificationType.mention:
        return f"{actor} mentioned you on {asset}", comment_preview or ""
    if t == NotificationType.comment:
        return f"{actor} commented on {asset}", comment_preview or ""
    if t == NotificationType.assignment:
        return f"{actor} assigned you to {asset}", ""
    if t == NotificationType.approval:
        return f"{actor} updated approval on {asset}", ""
    if t == NotificationType.due_soon:
        return f"{asset} is due soon", ""
    if t == NotificationType.status_change:
        to = payload.get("status_name") or "a new status"
        count = payload.get("asset_count")
        if count:
            names = list(payload.get("asset_names") or [])
            more = int(count) - len(names)
            body = ", ".join(names) + (f", and {more} more" if more > 0 else "") if names else ""
            return f"{actor} moved {count} assets to {to}", body
        from_name = payload.get("from_status_name")
        return f"{actor} moved {asset} to {to}", f"was {from_name}" if from_name else ""
    if t == NotificationType.delivery:
        if payload.get("status") == "failed":
            return f"Delivery of {asset} failed", str(payload.get("error") or "")
        return f"{asset} delivered to {payload.get('folder_name') or 'Google Drive'}", str(payload.get("file_name") or "")
    return "New notification", ""


def build_push_payload(db: Session, notification: Notification) -> Optional[dict]:
    """What the service worker shows: title, body, the URL a tap opens, and a
    tag so a re-delivered push replaces rather than duplicates. None when the
    asset is gone (trashed), as GET /me/notifications leaves such rows out."""
    asset = db.query(Asset).filter(Asset.id == notification.asset_id, Asset.deleted_at.is_(None)).first()
    if asset is None:
        return None
    comment = db.query(Comment).filter(Comment.id == notification.comment_id).first() if notification.comment_id else None
    preview = (comment.body[:100] if comment is not None and comment.body else None)
    actor = _actor_name(db, notification, comment)
    title, body = notification_text(notification, asset.name, actor, preview)
    return {
        "title": title,
        "body": body,
        "url": notification_url(notification, asset),
        "tag": str(notification.id),
        "type": notification.type.value,
    }


def notify_push(db: Session, notifications: Iterable[Notification]) -> None:
    """Queue a push for each notification row, after the commit that wrote
    them. Nothing when the instance has no VAPID keys. The task decides the
    rest (devices, preferences, text), so the request path stays cheap."""
    if not settings.push_enabled:
        return
    from ..tasks.push_tasks import send_push_notification  # the task imports this module

    for n in notifications:
        # None is a "nobody to tell" from a helper; an id of None is a row that
        # was never flushed (a test on a mocked session), not a row to push.
        if n is None or getattr(n, "id", None) is None:
            continue
        send_task_safe(send_push_notification, str(n.id))
