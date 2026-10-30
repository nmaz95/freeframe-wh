"""tasks/push_tasks.send_push_notification with the push service faked."""
import json
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from celery.exceptions import Retry
from pywebpush import WebPushException

import apps.api.tasks.push_tasks as pt
from apps.api.models.activity import NotificationType


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(pt.settings, "vapid_public_key", "pk")
    monkeypatch.setattr(pt.settings, "vapid_private_key", "sk")
    monkeypatch.setattr(pt.settings, "vapid_subject", "mailto:admin@example.com")
    monkeypatch.setattr(pt.settings, "frontend_url", "https://ff.example")


def _world(preferences=None, subs=2, type_=NotificationType.comment):
    user = SimpleNamespace(id=uuid.uuid4(), deleted_at=None, status="active", preferences=preferences or {})
    asset = SimpleNamespace(id=uuid.uuid4(), project_id=uuid.uuid4(), name="Spot 30s", deleted_at=None)
    note = SimpleNamespace(id=uuid.uuid4(), user_id=user.id, asset_id=asset.id, comment_id=None, actor_id=None, payload=None, type=type_, created_at=None)
    rows = [SimpleNamespace(id=uuid.uuid4(), user_id=user.id, endpoint=f"https://push.example/{i}", p256dh="p", auth="a", last_used_at=None, last_failed_at=None) for i in range(subs)]
    return user, asset, note, rows


def _db_for(note, user, rows, asset):
    db = MagicMock()
    by_model = {pt.Notification: note, pt.User: user, pt.Comment: None, pt.PushSubscription: rows}
    # push_service queries Asset through its own import of the model
    from apps.api.models.asset import Asset
    by_model[Asset] = asset

    def query(model):
        q = MagicMock()
        q.filter.return_value = q
        value = by_model.get(model)
        q.first.return_value = value if not isinstance(value, list) else None
        q.all.return_value = value if isinstance(value, list) else []
        return q
    db.query.side_effect = query
    return db


def test_a_push_goes_to_every_device_with_the_drawers_words(monkeypatch, enabled):
    user, asset, note, rows = _world()
    db = _db_for(note, user, rows, asset)
    monkeypatch.setattr(pt, "SessionLocal", lambda: db)
    calls = []
    monkeypatch.setattr(pt, "webpush", lambda **kw: calls.append(kw))

    pt.send_push_notification.run(str(note.id))

    assert [c["subscription_info"]["endpoint"] for c in calls] == [r.endpoint for r in rows]
    payload = json.loads(calls[0]["data"])
    assert payload["title"] == "Someone commented on Spot 30s"
    assert payload["url"] == f"https://ff.example/projects/{asset.project_id}/assets/{asset.id}"
    assert calls[0]["vapid_claims"] == {"sub": "mailto:admin@example.com"}
    assert calls[0]["vapid_private_key"] == "sk"
    assert all(r.last_used_at is not None for r in rows)
    db.commit.assert_called_once()
    db.close.assert_called_once()


def test_a_gone_subscription_is_deleted(monkeypatch, enabled):
    user, asset, note, rows = _world(subs=1)
    db = _db_for(note, user, rows, asset)
    monkeypatch.setattr(pt, "SessionLocal", lambda: db)

    def gone(**kw):
        raise WebPushException("gone", response=SimpleNamespace(status_code=410))
    monkeypatch.setattr(pt, "webpush", gone)

    pt.send_push_notification.run(str(note.id))

    db.delete.assert_called_once_with(rows[0])
    db.commit.assert_called_once()


def test_all_off_means_no_push(monkeypatch, enabled):
    user, asset, note, rows = _world(preferences={"notifications": {"general_comments": "all_off"}})
    db = _db_for(note, user, rows, asset)
    monkeypatch.setattr(pt, "SessionLocal", lambda: db)
    calls = []
    monkeypatch.setattr(pt, "webpush", lambda **kw: calls.append(kw))
    pt.send_push_notification.run(str(note.id))
    assert calls == []


def test_no_devices_means_no_payload_work(monkeypatch, enabled):
    user, asset, note, rows = _world(subs=0)
    db = _db_for(note, user, rows, asset)
    monkeypatch.setattr(pt, "SessionLocal", lambda: db)
    built = []
    monkeypatch.setattr(pt, "build_push_payload", lambda db, n: built.append(n) or None)
    pt.send_push_notification.run(str(note.id))
    assert built == []


def test_a_server_error_from_the_push_service_is_retried(monkeypatch, enabled):
    user, asset, note, rows = _world(subs=1)
    db = _db_for(note, user, rows, asset)
    monkeypatch.setattr(pt, "SessionLocal", lambda: db)

    def down(**kw):
        raise WebPushException("down", response=SimpleNamespace(status_code=503))
    monkeypatch.setattr(pt, "webpush", down)
    task = pt.send_push_notification
    task.push_request(retries=0, called_directly=False)
    try:
        with patch.object(task, "retry", side_effect=Retry()) as retry:
            with pytest.raises(Retry):
                task.run(str(note.id))
    finally:
        task.pop_request()
    retry.assert_called_once()
    db.delete.assert_not_called()


def test_a_bad_key_is_noted_and_not_retried(monkeypatch, enabled):
    user, asset, note, rows = _world(subs=1)
    db = _db_for(note, user, rows, asset)
    monkeypatch.setattr(pt, "SessionLocal", lambda: db)

    def refused(**kw):
        raise WebPushException("forbidden", response=SimpleNamespace(status_code=403))
    monkeypatch.setattr(pt, "webpush", refused)
    pt.send_push_notification.run(str(note.id))
    assert rows[0].last_failed_at is not None
    db.delete.assert_not_called()


def test_nothing_happens_without_keys(monkeypatch):
    for name in ("vapid_public_key", "vapid_private_key", "vapid_subject"):
        monkeypatch.setattr(pt.settings, name, "")
    opened = []
    monkeypatch.setattr(pt, "SessionLocal", lambda: opened.append(1) or MagicMock())
    pt.send_push_notification.run(str(uuid.uuid4()))
    assert opened == []
