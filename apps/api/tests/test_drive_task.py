"""tasks/drive_tasks.deliver_to_drive with the storage and Google calls faked."""
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
from celery.exceptions import Retry

import apps.api.tasks.drive_tasks as dt
from apps.api.models.activity import Notification, NotificationType
from apps.api.models.integration import DeliveryStatus
from apps.api.services.google_drive import GoogleAuthError


def _world():
    delivery = SimpleNamespace(
        id=uuid.uuid4(), asset_id=uuid.uuid4(), version_id=uuid.uuid4(), user_id=uuid.uuid4(),
        folder_id="f-1", folder_name="Consegne / Barilla", file_name="Spot 30s v3.mov",
        status=DeliveryStatus.queued, progress_percent=0, drive_file_id=None, web_view_link=None, error=None,
    )
    asset = SimpleNamespace(id=delivery.asset_id, project_id=uuid.uuid4())
    media = SimpleNamespace(version_id=delivery.version_id, file_size_bytes=6, mime_type="video/quicktime", s3_key_raw="raw/a/spot.mov")
    user = SimpleNamespace(id=delivery.user_id, email="u@example.com", name="U")
    conn = SimpleNamespace(user_id=delivery.user_id, refresh_token_encrypted="enc")
    return delivery, asset, media, user, conn


def _db_for(delivery, asset, media, user, conn):
    db = MagicMock()
    by_model = {
        dt.DriveDelivery: delivery, dt.Asset: asset, dt.MediaFile: media, dt.User: user, dt.GoogleConnection: conn,
    }

    def query(model):
        q = MagicMock()
        q.filter.return_value = q
        q.first.return_value = by_model.get(model)
        return q
    db.query.side_effect = query
    return db


def _s3_with(body: bytes):
    s3 = MagicMock()
    stream = MagicMock()
    stream.iter_chunks = lambda chunk_size: iter([body[:4], body[4:]])
    s3.get_object.return_value = {"Body": stream}
    return s3


def test_a_delivery_streams_the_original_and_tells_the_sender(monkeypatch):
    delivery, asset, media, user, conn = _world()
    db = _db_for(delivery, asset, media, user, conn)
    monkeypatch.setattr(dt, "SessionLocal", lambda: db)
    monkeypatch.setattr(dt, "decrypt_secret", lambda enc: "rt")
    monkeypatch.setattr(dt.google_drive, "refresh_access_token", lambda rt: {"access_token": "at"})
    monkeypatch.setattr(dt.google_drive, "start_resumable_upload", lambda at, **kw: "https://s/1")
    sent = {}

    def upload(session_uri, chunks, total, on_progress=None, **kw):
        sent["data"] = b"".join(chunks)
        sent["total"] = total
        on_progress(50); on_progress(100)
        return {"id": "file-1", "webViewLink": "https://drive.google.com/file/d/file-1/view"}
    monkeypatch.setattr(dt.google_drive, "upload_resumable", upload)
    monkeypatch.setattr(dt, "get_s3_client", lambda: _s3_with(b"abcdef"))
    events = []
    monkeypatch.setattr(dt.event_service, "publish_sync", lambda pid, et, payload: events.append((et, payload["status"], payload["percent"])) or True)

    dt.deliver_to_drive.run(str(delivery.id))

    assert sent == {"data": b"abcdef", "total": 6}
    assert delivery.status == DeliveryStatus.done
    assert delivery.drive_file_id == "file-1" and delivery.web_view_link.endswith("/view")
    [note] = [a for (a,), _ in db.add.call_args_list if isinstance(a, Notification)]
    assert note.type == NotificationType.delivery and note.user_id == user.id
    assert note.payload["status"] == "done" and note.payload["folder_name"] == "Consegne / Barilla"
    assert events[0] == ("delivery_updated", "uploading", 0)
    assert events[-1] == ("delivery_updated", "done", 100)
    assert db.close.called


def test_a_dead_google_grant_fails_the_delivery_without_retrying(monkeypatch):
    delivery, asset, media, user, conn = _world()
    db = _db_for(delivery, asset, media, user, conn)
    monkeypatch.setattr(dt, "SessionLocal", lambda: db)
    monkeypatch.setattr(dt, "decrypt_secret", lambda enc: "rt")

    def dead(rt):
        raise GoogleAuthError("Google account disconnected: reconnect it in Settings → Profile")
    monkeypatch.setattr(dt.google_drive, "refresh_access_token", dead)
    monkeypatch.setattr(dt.event_service, "publish_sync", lambda *a, **k: True)

    dt.deliver_to_drive.run(str(delivery.id))

    assert delivery.status == DeliveryStatus.failed
    assert "reconnect" in delivery.error
    [note] = [a for (a,), _ in db.add.call_args_list if isinstance(a, Notification)]
    assert note.payload["status"] == "failed"


def test_a_network_failure_is_retried(monkeypatch):
    delivery, asset, media, user, conn = _world()
    db = _db_for(delivery, asset, media, user, conn)
    monkeypatch.setattr(dt, "SessionLocal", lambda: db)
    monkeypatch.setattr(dt, "decrypt_secret", lambda enc: "rt")
    monkeypatch.setattr(dt.google_drive, "refresh_access_token", lambda rt: {"access_token": "at"})

    def flaky(at, **kw):
        raise httpx.ConnectError("boom")
    monkeypatch.setattr(dt.google_drive, "start_resumable_upload", flaky)
    monkeypatch.setattr(dt.event_service, "publish_sync", lambda *a, **k: True)

    task = dt.deliver_to_drive
    task.push_request(retries=0, called_directly=False)
    try:
        with patch.object(task, "retry", side_effect=Retry()) as retry:
            try:
                task.run(str(delivery.id))
            except Retry:
                pass
        assert retry.called
    finally:
        task.pop_request()
    assert delivery.status == DeliveryStatus.uploading  # left for the retry to finish


def test_a_missing_connection_fails_cleanly(monkeypatch):
    delivery, asset, media, user, _ = _world()
    db = _db_for(delivery, asset, media, user, None)
    monkeypatch.setattr(dt, "SessionLocal", lambda: db)
    monkeypatch.setattr(dt.event_service, "publish_sync", lambda *a, **k: True)
    dt.deliver_to_drive.run(str(delivery.id))
    assert delivery.status == DeliveryStatus.failed
    assert "reconnect" in delivery.error
