"""Deliver one in-app notification to every device its user turned push on in.

One task per Notification row, queued by `services.push_service.notify_push`
after the commit that wrote the row. The task loads the row and decides
everything else here, in the worker: whether the user still exists and has
devices, whether their Settings → Notifications choice allows this type,
the words and the URL, and then one Web Push per device.

The push service's answer drives the row's fate: 404 and 410 mean the
subscription is gone and the row goes with it; 429 and 5xx are retried;
any other 4xx (a bad VAPID key, a key mismatch) is noted on the row and
logged, never retried. Nothing here raises past the task: a push is a
courtesy, never the reason a comment or a status change fails.
"""
import json
import logging
from datetime import datetime, timedelta, timezone

import requests
from celery.exceptions import Retry
from pywebpush import WebPushException, webpush

from ..config import settings
from ..database import SessionLocal
from ..models.activity import Notification, NotificationType
from ..models.comment import Comment
from ..models.push import PushSubscription
from ..models.user import User, UserStatus
from ..services.push_service import build_push_payload, preference_key, push_allowed
from .celery_app import celery_app

log = logging.getLogger("celery.push")

# A reminder row is written every hour while an asset is due within a day
# (reminder_tasks.py); one push per day for it is plenty.
DUE_SOON_PUSH_WINDOW = timedelta(hours=24)


def _subscription_info(sub: PushSubscription) -> dict:
    return {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}


def _status_code(exc: WebPushException):
    response = getattr(exc, "response", None)
    return getattr(response, "status_code", None) if response is not None else None


@celery_app.task(bind=True, queue="email_low", max_retries=3, default_retry_delay=60)
def send_push_notification(self, notification_id: str):
    if not settings.push_enabled:
        return
    db = SessionLocal()
    try:
        notification = db.query(Notification).filter(Notification.id == notification_id).first()
        if notification is None:
            return
        user = db.query(User).filter(User.id == notification.user_id).first()
        if user is None or user.deleted_at is not None or user.status == UserStatus.deactivated:
            return
        subs = db.query(PushSubscription).filter(PushSubscription.user_id == user.id).all()
        if not subs:
            return  # the common case: push is off for this person

        comment = db.query(Comment).filter(Comment.id == notification.comment_id).first() if notification.comment_id else None
        if not push_allowed(user.preferences, preference_key(notification, comment)):
            return
        if notification.type == NotificationType.due_soon and _due_soon_already_pushed(db, notification):
            return

        payload = build_push_payload(db, notification)
        if payload is None:
            return
        data = json.dumps(payload)

        now = datetime.now(timezone.utc)
        retry = False
        for sub in subs:
            try:
                webpush(
                    subscription_info=_subscription_info(sub),
                    data=data,
                    vapid_private_key=settings.vapid_private_key,
                    # A fresh dict per call: pywebpush writes `aud` and `exp` into it.
                    vapid_claims={"sub": settings.vapid_subject},
                    ttl=settings.push_ttl_seconds,
                    headers={"Urgency": "normal"},
                )
                sub.last_used_at = now
            except WebPushException as exc:
                code = _status_code(exc)
                if code in (404, 410):
                    log.info("push subscription %s gone (%s): removed", sub.id, code)
                    db.delete(sub)
                elif code == 429 or (code is not None and code >= 500):
                    retry = True
                    log.warning("push to %s refused with %s: will retry", sub.id, code)
                else:
                    sub.last_failed_at = now
                    log.warning("push to %s failed (%s): %s", sub.id, code, str(exc)[:200])
            except requests.exceptions.RequestException as exc:
                retry = True
                log.warning("push to %s: network error %s: will retry", sub.id, type(exc).__name__)
        db.commit()
        if retry:
            if self.request.retries < self.max_retries:
                raise self.retry(countdown=60 * (self.request.retries + 1))
            log.warning("push for notification %s gave up after %s retries", notification_id, self.max_retries)
    except Retry:
        raise
    except Exception:
        log.exception("push for notification %s failed", notification_id)
    finally:
        db.close()


def _due_soon_already_pushed(db, notification: Notification) -> bool:
    created = notification.created_at or datetime.now(timezone.utc)
    earlier = (
        db.query(Notification)
        .filter(
            Notification.user_id == notification.user_id,
            Notification.asset_id == notification.asset_id,
            Notification.type == NotificationType.due_soon,
            Notification.id != notification.id,
            Notification.created_at >= created - DUE_SOON_PUSH_WINDOW,
            Notification.created_at < created,
        )
        .first()
    )
    return earlier is not None
