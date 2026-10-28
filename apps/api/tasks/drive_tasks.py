"""Copy an asset's original from storage to Google Drive, as the sender.

One task per delivery row. It streams the object from S3 straight into a
Drive resumable upload, chunk by chunk, so nothing touches the disk and a
multi-gigabyte master costs memory of one chunk. Progress goes to the
project's event stream; the sender gets an in-app notification at the end,
whichever way it ended.
"""
import logging
import uuid

import httpx
from botocore.exceptions import BotoCoreError, ClientError
from celery.exceptions import Retry

from ..config import settings
from ..database import SessionLocal
from ..models.activity import Notification, NotificationType
from ..models.asset import Asset, MediaFile
from ..models.integration import DeliveryStatus, DriveDelivery, GoogleConnection
from ..models.user import User
from ..services import event_service, google_drive
from ..services.crypto_service import decrypt_secret
from ..services.s3_service import get_s3_client
from .celery_app import celery_app

log = logging.getLogger("celery.delivery")

DELIVERY_EVENT = "delivery_updated"


def _publish(project_id, delivery: DriveDelivery) -> bool:
    return event_service.publish_sync(project_id, DELIVERY_EVENT, {
        "delivery_id": str(delivery.id),
        "asset_id": str(delivery.asset_id),
        "user_id": str(delivery.user_id),
        "status": delivery.status,
        "percent": delivery.progress_percent,
    })


def _notify(db, delivery: DriveDelivery) -> None:
    db.add(Notification(
        user_id=delivery.user_id,
        type=NotificationType.delivery,
        asset_id=delivery.asset_id,
        actor_id=delivery.user_id,
        payload={
            "delivery_id": str(delivery.id),
            "status": delivery.status,
            "folder_name": delivery.folder_name,
            "file_name": delivery.file_name,
            "web_view_link": delivery.web_view_link,
            "error": delivery.error,
        },
    ))


def _fail(db, project_id, delivery: DriveDelivery, message: str) -> None:
    delivery.status = DeliveryStatus.failed
    delivery.error = message[:1000]
    _notify(db, delivery)
    db.commit()
    _publish(project_id, delivery)
    log.warning("delivery %s failed: %s", delivery.id, message)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def deliver_to_drive(self, delivery_id: str):
    db = SessionLocal()
    project_id = None
    delivery = None
    try:
        delivery = db.query(DriveDelivery).filter(DriveDelivery.id == uuid.UUID(delivery_id)).first()
        if delivery is None or delivery.status == DeliveryStatus.done:
            return
        asset = db.query(Asset).filter(Asset.id == delivery.asset_id).first()
        media_file = db.query(MediaFile).filter(MediaFile.version_id == delivery.version_id).first()
        user = db.query(User).filter(User.id == delivery.user_id).first()
        conn = db.query(GoogleConnection).filter(GoogleConnection.user_id == delivery.user_id).first()
        if asset is None or media_file is None or user is None:
            _fail(db, asset.project_id if asset else None, delivery, "The asset or its file is gone")
            return
        project_id = asset.project_id
        if conn is None:
            _fail(db, project_id, delivery, "Google account disconnected: reconnect it in Settings → Profile")
            return
        try:
            refresh_token = decrypt_secret(conn.refresh_token_encrypted)
        except Exception:  # noqa: BLE001 - encrypted under a key we no longer have
            _fail(db, project_id, delivery, "Google account disconnected: reconnect it in Settings → Profile")
            return

        access_token = google_drive.refresh_access_token(refresh_token)["access_token"]

        delivery.status = DeliveryStatus.uploading
        delivery.error = None
        db.commit()
        _publish(project_id, delivery)

        size = int(media_file.file_size_bytes or 0)
        session_uri = google_drive.start_resumable_upload(
            access_token,
            name=delivery.file_name,
            mime_type=media_file.mime_type or "application/octet-stream",
            size=size,
            parent_id=delivery.folder_id,
        )
        body = get_s3_client().get_object(Bucket=settings.s3_bucket, Key=media_file.s3_key_raw)["Body"]

        # Progress is cosmetic: stop publishing after the first miss, as the
        # transcode does, rather than pay a timeout per chunk.
        progress = {"enabled": True}

        def on_progress(percent: int) -> None:
            delivery.progress_percent = percent
            db.commit()
            if progress["enabled"] and _publish(project_id, delivery) is False:
                progress["enabled"] = False

        result = google_drive.upload_resumable(
            session_uri, body.iter_chunks(google_drive.CHUNK_SIZE), size, on_progress=on_progress,
        )
        delivery.status = DeliveryStatus.done
        delivery.progress_percent = 100
        delivery.drive_file_id = result.get("id")
        delivery.web_view_link = result.get("webViewLink")
        _notify(db, delivery)
        db.commit()
        _publish(project_id, delivery)
        log.info("delivery %s done: %s -> %s", delivery.id, delivery.file_name, delivery.folder_name)
    except Retry:
        raise
    except google_drive.GoogleDriveError as exc:
        # Auth gone or Drive refused: retrying would only repeat the answer.
        _fail(db, project_id, delivery, str(exc))
    except (httpx.TransportError, ClientError, BotoCoreError, OSError) as exc:
        if self.request.retries < self.max_retries:
            log.warning("delivery %s: %s; retrying", delivery_id, exc)
            raise self.retry(exc=exc)
        _fail(db, project_id, delivery, "The copy to Drive kept failing; try again later")
    except Exception as exc:  # noqa: BLE001 - recorded on the row, never swallowed silently
        log.exception("delivery %s: unexpected error", delivery_id)
        if delivery is not None:
            _fail(db, project_id, delivery, f"Unexpected error: {type(exc).__name__}")
    finally:
        db.close()
