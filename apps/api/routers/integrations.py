"""Google Drive: connecting an account, the Picker's token, and deliveries.

The OAuth dance binds the browser redirect to a signed-in user through a
single-use state kept in Redis, since the callback arrives without a bearer
token. A delivery is a background copy of an asset's original to the folder
the person picked; it is queued here and done by tasks/drive_tasks.py.
"""
import secrets
import uuid
from datetime import datetime
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..middleware.auth import get_current_user
from ..middleware.rate_limit import rate_limit
from ..models.asset import Asset, AssetVersion
from ..models.instance_settings import InstanceSettings
from ..models.integration import DeliveryStatus, DriveDelivery, GoogleConnection
from ..models.project import ProjectRole
from ..models.user import User, UserStatus
from ..schemas.integration import (
    DeliveriesCreate, DeliveryCreate, DeliveryItem, DeliveryResponse, DriveFolderCreate, DriveFolderRename,
    DriveFolderResponse, GoogleAuthorizeResponse, GoogleStatusResponse, PickerConfigResponse,
)
from ..services import google_drive
from ..services.crypto_service import decrypt_secret, encrypt_secret
from ..services.permissions import require_asset_access, require_project_role, require_project_visible
from ..services.redis_service import pop_oauth_state, store_oauth_state
from ..services.s3_service import build_download_filename
from ..tasks.celery_app import send_task_safe
from ..tasks.drive_tasks import deliver_to_drive
from .assets import _ready_media_file

router = APIRouter(tags=["integrations"])


def _require_enabled() -> None:
    if not settings.google_drive_enabled:
        raise HTTPException(status_code=503, detail="Google Drive is not configured on this instance")


def _connection(db: Session, user_id: uuid.UUID) -> GoogleConnection | None:
    return db.query(GoogleConnection).filter(GoogleConnection.user_id == user_id).first()


def _frontend_redirect(**params: str) -> RedirectResponse:
    base = settings.frontend_url.rstrip("/")
    return RedirectResponse(url=f"{base}/settings/profile?{urlencode(params)}", status_code=302)


# ─── Connecting an account ────────────────────────────────────────────────────

@router.get("/integrations/google", response_model=GoogleStatusResponse)
def google_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    conn = _connection(db, current_user.id) if settings.google_drive_enabled else None
    return GoogleStatusResponse(
        enabled=settings.google_drive_enabled,
        connected=conn is not None,
        email=conn.google_email if conn else None,
        connected_at=conn.updated_at if conn else None,
    )


@router.post(
    "/integrations/google/authorize",
    response_model=GoogleAuthorizeResponse,
    dependencies=[Depends(rate_limit("gdrive_authorize", 10, 600))],
)
def google_authorize(current_user: User = Depends(get_current_user)):
    """The consent URL to send the browser to. Its state names this user for
    ten minutes, once."""
    _require_enabled()
    nonce = secrets.token_urlsafe(32)
    store_oauth_state(nonce, str(current_user.id))
    return GoogleAuthorizeResponse(url=google_drive.authorization_url(nonce))


@router.get(
    "/integrations/google/callback",
    include_in_schema=False,
    dependencies=[Depends(rate_limit("gdrive_callback", 20, 600))],
)
def google_callback(
    state: str = Query(default=""),
    code: str = Query(default=""),
    error: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """Where Google sends the browser back. No bearer: the state is the identity."""
    if not settings.google_drive_enabled:
        return _frontend_redirect(google="error", reason="not_configured")
    user_id = pop_oauth_state(state) if state else None
    if not user_id:
        return _frontend_redirect(google="error", reason="state")
    if error or not code:
        return _frontend_redirect(google="error", reason="denied")
    user = db.query(User).filter(User.id == uuid.UUID(user_id), User.deleted_at.is_(None)).first()
    if user is None or user.status == UserStatus.deactivated:
        return _frontend_redirect(google="error", reason="user")
    try:
        tokens = google_drive.exchange_code(code)
        refresh_token = tokens.get("refresh_token")
        if not refresh_token:
            return _frontend_redirect(google="error", reason="no_refresh_token")
        info = google_drive.userinfo(tokens["access_token"])
    except google_drive.GoogleDriveError:
        return _frontend_redirect(google="error", reason="google")
    conn = _connection(db, user.id)
    if conn is None:
        conn = GoogleConnection(id=uuid.uuid4(), user_id=user.id, google_email="", refresh_token_encrypted="")
        db.add(conn)
    conn.google_email = info.get("email") or "unknown"
    conn.refresh_token_encrypted = encrypt_secret(refresh_token)
    conn.scopes = tokens.get("scope", "")
    db.commit()
    return _frontend_redirect(google="connected")


@router.delete("/integrations/google", status_code=status.HTTP_204_NO_CONTENT)
def google_disconnect(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    conn = _connection(db, current_user.id)
    if conn is None:
        return
    try:
        google_drive.revoke_token(decrypt_secret(conn.refresh_token_encrypted))
    except Exception:  # noqa: BLE001 - an undecryptable or dead token is gone either way
        pass
    db.delete(conn)
    db.commit()


def _root_folder(db: Session) -> tuple[str, str | None]:
    row = db.query(InstanceSettings).first()
    root = (row.drive_root_folder_id if row else None) or ""
    if not root:
        raise HTTPException(status_code=409, detail="The deliveries folder is not set yet (Admin → Instance settings)")
    return root, row.drive_root_folder_name


def _access_token_for(db: Session, user: User) -> str:
    conn = _connection(db, user.id)
    if conn is None:
        raise HTTPException(status_code=409, detail="Your Google account is not connected")
    try:
        refresh_token = decrypt_secret(conn.refresh_token_encrypted)
        return google_drive.refresh_access_token(refresh_token)["access_token"]
    except google_drive.GoogleAuthError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except google_drive.GoogleDriveError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception:  # noqa: BLE001 - a token encrypted under a previous JWT_SECRET
        raise HTTPException(status_code=409, detail="Google account disconnected: reconnect it in Settings → Profile")


@router.get("/integrations/google/picker", response_model=PickerConfigResponse)
def google_picker_config(
    scope: str = Query(default="deliveries"),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """What the browser needs to open the Picker on the deliveries folder: a
    short-lived access token (the refresh token never leaves the server).
    `scope=root` is for an admin choosing that folder, so it needs none yet."""
    _require_enabled()
    if scope == "root":
        if not current_user.is_superadmin:
            raise HTTPException(status_code=403, detail="Admin access required")
        root_id, root_name = "", None
    else:
        root_id, root_name = _root_folder(db)
    conn = _connection(db, current_user.id)
    if conn is None:
        raise HTTPException(status_code=409, detail="Your Google account is not connected")
    try:
        tokens = google_drive.refresh_access_token(decrypt_secret(conn.refresh_token_encrypted))
    except google_drive.GoogleAuthError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except google_drive.GoogleDriveError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=409, detail="Google account disconnected: reconnect it in Settings → Profile")
    return PickerConfigResponse(
        access_token=tokens["access_token"],
        expires_in=int(tokens.get("expires_in", 3600)),
        api_key=settings.google_api_key,
        app_id=settings.google_app_id,
        root_folder_id=root_id,
        root_folder_name=root_name,
    )


# ─── Deliveries ───────────────────────────────────────────────────────────────

def _delivery_response(d: DriveDelivery, user_name: str | None, version_number: int | None) -> DeliveryResponse:
    return DeliveryResponse(
        id=d.id, asset_id=d.asset_id, version_id=d.version_id, version_number=version_number,
        user_id=d.user_id, user_name=user_name, folder_id=d.folder_id, folder_name=d.folder_name,
        file_name=d.file_name, status=d.status, progress_percent=d.progress_percent,
        drive_file_id=d.drive_file_id, web_view_link=d.web_view_link, error=d.error,
        created_at=d.created_at or datetime.now(), updated_at=d.updated_at,
    )


@router.get("/assets/{asset_id}/deliveries", response_model=list[DeliveryResponse])
def list_deliveries(asset_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    require_asset_access(db, asset, current_user)
    rows = (
        db.query(DriveDelivery, User.name, AssetVersion.version_number)
        .outerjoin(User, User.id == DriveDelivery.user_id)
        .outerjoin(AssetVersion, AssetVersion.id == DriveDelivery.version_id)
        .filter(DriveDelivery.asset_id == asset_id)
        .order_by(DriveDelivery.created_at.desc())
        .limit(50)
        .all()
    )
    return [_delivery_response(d, name, vn) for d, name, vn in rows]


def _new_delivery(
    asset: Asset, media_file, version_number: int | None, user: User,
    folder_id: str, folder_name: str, file_name: str | None,
) -> DriveDelivery:
    stem = f"{asset.name} v{version_number}" if version_number else asset.name
    return DriveDelivery(
        id=uuid.uuid4(),
        asset_id=asset.id,
        version_id=media_file.version_id,
        user_id=user.id,
        folder_id=folder_id,
        folder_name=folder_name,
        file_name=file_name or build_download_filename(stem, media_file.s3_key_raw, media_file.original_filename),
        status=DeliveryStatus.queued,
        progress_percent=0,
    )


def _queue_deliveries(
    db: Session, project_id: uuid.UUID, user: User, folder_id: str, folder_name: str, items: list[DeliveryItem],
) -> list[tuple[DriveDelivery, int | None]]:
    """Queue one copy per item, all or none: the role once, every asset live
    and in this project (404 otherwise), every version ready (409 naming the
    asset), then the rows in one commit and a task each."""
    _require_enabled()
    require_project_role(db, project_id, user, ProjectRole.editor)
    if _connection(db, user.id) is None:
        raise HTTPException(status_code=409, detail="Your Google account is not connected")
    wanted: dict[uuid.UUID, DeliveryItem] = {}
    for item in items:
        wanted.setdefault(item.asset_id, item)
    assets = (
        db.query(Asset)
        .filter(Asset.id.in_(list(wanted)), Asset.project_id == project_id, Asset.deleted_at.is_(None))
        .all()
    )
    by_id = {a.id: a for a in assets}
    if len(by_id) != len(wanted):
        raise HTTPException(status_code=404, detail="Asset not found")
    checked: list[tuple[Asset, DeliveryItem, object]] = []
    for asset_id, item in wanted.items():
        asset = by_id[asset_id]
        try:
            _, media_file = _ready_media_file(db, asset.id, item.version_id, user)
        except HTTPException as exc:
            if exc.status_code in (404, 409):
                raise HTTPException(status_code=exc.status_code, detail=f"{asset.name}: {exc.detail}")
            raise
        checked.append((asset, item, media_file))
    version_ids = list({mf.version_id for _, _, mf in checked})
    versions = db.query(AssetVersion).filter(AssetVersion.id.in_(version_ids)).all()
    number_of = {v.id: v.version_number for v in versions}
    rows = [
        (_new_delivery(asset, mf, number_of.get(mf.version_id), user, folder_id, folder_name, item.file_name),
         number_of.get(mf.version_id))
        for asset, item, mf in checked
    ]
    db.add_all([row for row, _ in rows])
    db.commit()
    for row, _ in rows:
        db.refresh(row)
    for row, _ in rows:
        send_task_safe(deliver_to_drive, str(row.id))
    return rows


@router.post(
    "/assets/{asset_id}/deliveries",
    response_model=DeliveryResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("gdrive_send", 30, 60))],
)
def create_delivery(
    asset_id: uuid.UUID, body: DeliveryCreate,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """Queue a copy of the asset's original to a Drive folder, as this user."""
    _require_enabled()
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    item = DeliveryItem(asset_id=asset_id, file_name=body.file_name, version_id=body.version_id)
    [(delivery, version_number)] = _queue_deliveries(
        db, asset.project_id, current_user, body.folder_id, body.folder_name, [item],
    )
    return _delivery_response(delivery, current_user.name, version_number)


@router.post(
    "/projects/{project_id}/deliveries",
    response_model=list[DeliveryResponse],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("gdrive_send", 30, 60))],
)
def create_deliveries(
    project_id: uuid.UUID, body: DeliveriesCreate,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """Queue copies of several assets of one project to one Drive folder, as
    this user: all of them, in the order asked, or none (see `_queue_deliveries`)."""
    rows = _queue_deliveries(db, project_id, current_user, body.folder_id, body.folder_name, body.items)
    return [_delivery_response(d, current_user.name, vn) for d, vn in rows]


@router.get("/projects/{project_id}/deliveries", response_model=list[DeliveryResponse])
def list_project_deliveries(
    project_id: uuid.UUID,
    ids: str = Query(..., description="Comma-separated delivery ids, up to 100"),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """A batch of deliveries by id, in the order asked; ids from another
    project are left out rather than answered."""
    try:
        wanted = [uuid.UUID(i.strip()) for i in ids.split(",") if i.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid delivery id")
    if not wanted or len(wanted) > 100:
        raise HTTPException(status_code=400, detail="Between 1 and 100 delivery ids")
    require_project_visible(db, project_id, current_user)
    rows = (
        db.query(DriveDelivery, User.name, AssetVersion.version_number)
        .join(Asset, Asset.id == DriveDelivery.asset_id)
        .outerjoin(User, User.id == DriveDelivery.user_id)
        .outerjoin(AssetVersion, AssetVersion.id == DriveDelivery.version_id)
        .filter(DriveDelivery.id.in_(wanted), Asset.project_id == project_id)
        .all()
    )
    by_id = {d.id: (d, name, vn) for d, name, vn in rows}
    return [_delivery_response(*by_id[i]) for i in wanted if i in by_id]


# ─── Drive folders ────────────────────────────────────────────────────────────

_FOLDER_ID = Path(max_length=128, pattern=r"^[A-Za-z0-9_-]+$")


def _folder_call(fn):
    """Run a Drive folder call and turn its failures into answers."""
    try:
        f = fn()
    except google_drive.GoogleFolderNotFound:
        raise HTTPException(
            status_code=409,
            detail="FreeFrame can't see that folder with your Google account; pick it again with Choose folder",
        )
    except google_drive.GoogleAuthError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except google_drive.GoogleDriveError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return DriveFolderResponse(id=f["id"], name=f.get("name") or "", web_view_link=f.get("webViewLink"))


@router.post(
    "/integrations/google/folders",
    response_model=DriveFolderResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("gdrive_folder", 30, 60))],
)
def create_drive_folder(
    body: DriveFolderCreate,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """A new folder inside one the person picked, created as them. With
    drive.file the parent has to be one this account picked (or created
    here): the deliveries root itself is not, unless it was picked too."""
    _require_enabled()
    token = _access_token_for(db, current_user)
    return _folder_call(lambda: google_drive.create_folder(token, name=body.name, parent_id=body.parent_id))


@router.patch("/integrations/google/folders/{folder_id}", response_model=DriveFolderResponse)
def rename_drive_folder(
    body: DriveFolderRename,
    folder_id: str = _FOLDER_ID,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """Rename a folder this app created for this account."""
    _require_enabled()
    token = _access_token_for(db, current_user)
    return _folder_call(lambda: google_drive.rename_folder(token, folder_id, name=body.name))
