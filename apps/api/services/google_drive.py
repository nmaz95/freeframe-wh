"""Google OAuth and Drive: the few REST calls FreeFrame makes, over httpx.

No Google client library: an authorization URL, a code exchange, a token
refresh, a userinfo lookup and a resumable upload are each one or two plain
requests, and keeping them here keeps the dependency list as it is. Every
function takes an optional `client` so tests can hand in an `httpx.Client`
built on `httpx.MockTransport`.
"""
from __future__ import annotations

import logging
import time
from typing import Callable, Iterable, Optional
from urllib.parse import urlencode

import httpx

try:
    from ..config import settings
except ImportError:
    from config import settings

log = logging.getLogger("google_drive")

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
FILES_URL = "https://www.googleapis.com/drive/v3/files"
FOLDER_MIME = "application/vnd.google-apps.folder"

# drive.file is enough: the app sees only what people pick in the Picker and
# what it creates itself, and Google treats it as non-sensitive (no review).
SCOPES = ("openid", "email", "https://www.googleapis.com/auth/drive.file")

# Resumable uploads want every chunk but the last to be a multiple of 256 KiB.
CHUNK_SIZE = 8 * 1024 * 1024
_RETRYABLE = {408, 429, 500, 502, 503, 504}
_BACKOFF_SECONDS = (1, 2, 4, 8, 16)


class GoogleDriveError(Exception):
    """Google refused something for good; retrying would not help."""


class GoogleAuthError(GoogleDriveError):
    """The user's authorization is gone (revoked, expired, or undecryptable)."""


class GoogleFolderNotFound(GoogleDriveError):
    """Drive answered 404: under drive.file that usually means the folder was
    never picked (or created) by this app for this account."""


class _Transient(Exception):
    pass


def _client() -> httpx.Client:
    # Long read timeout: a chunk's PUT answers only once Google has it.
    return httpx.Client(timeout=httpx.Timeout(30.0, read=180.0))


def _json_or_text(r: httpx.Response) -> str:
    try:
        body = r.json()
        err = body.get("error")
        if isinstance(err, dict):
            return str(err.get("message") or err)
        if err:
            return f"{err}: {body.get('error_description', '')}".strip(": ")
    except Exception:  # noqa: BLE001 - any non-JSON body
        pass
    return r.text[:200]


# ─── OAuth ────────────────────────────────────────────────────────────────────

def authorization_url(state: str) -> str:
    params = {
        "client_id": settings.google_oauth_client_id,
        "redirect_uri": settings.google_oauth_redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        # A refresh token only comes with offline access, and only on a consent
        # Google actually showed; prompt=consent asks every time so reconnecting
        # after a disconnect yields a new one.
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def exchange_code(code: str, client: Optional[httpx.Client] = None) -> dict:
    c = client or _client()
    r = c.post(TOKEN_URL, data={
        "code": code,
        "client_id": settings.google_oauth_client_id,
        "client_secret": settings.google_oauth_client_secret,
        "redirect_uri": settings.google_oauth_redirect_uri,
        "grant_type": "authorization_code",
    })
    if r.status_code != 200:
        raise GoogleDriveError(f"Google did not accept the sign-in: {_json_or_text(r)}")
    return r.json()


def refresh_access_token(refresh_token: str, client: Optional[httpx.Client] = None) -> dict:
    """A fresh access token, or GoogleAuthError when the grant is gone."""
    c = client or _client()
    r = c.post(TOKEN_URL, data={
        "refresh_token": refresh_token,
        "client_id": settings.google_oauth_client_id,
        "client_secret": settings.google_oauth_client_secret,
        "grant_type": "refresh_token",
    })
    if r.status_code == 200:
        return r.json()
    if r.status_code in (400, 401):
        raise GoogleAuthError("Google account disconnected: reconnect it in Settings → Profile")
    raise GoogleDriveError(f"Could not refresh the Google token: {_json_or_text(r)}")


def revoke_token(token: str, client: Optional[httpx.Client] = None) -> None:
    """Best effort: a token that is already gone is fine."""
    c = client or _client()
    try:
        c.post(REVOKE_URL, data={"token": token})
    except httpx.HTTPError as exc:
        log.info("google token revoke did not go through: %s", exc)


def userinfo(access_token: str, client: Optional[httpx.Client] = None) -> dict:
    c = client or _client()
    r = c.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
    if r.status_code != 200:
        raise GoogleDriveError(f"Could not read the Google account: {_json_or_text(r)}")
    return r.json()


# ─── Drive folders ────────────────────────────────────────────────────────────

_FOLDER_FIELDS = {"fields": "id,name,webViewLink", "supportsAllDrives": "true"}


def _folder_result(r: httpx.Response, what: str) -> dict:
    if r.status_code == 200:
        return r.json()
    if r.status_code == 401:
        raise GoogleAuthError("Google account disconnected: reconnect it in Settings → Profile")
    if r.status_code == 404:
        raise GoogleFolderNotFound("Drive can't find that folder for this account")
    raise GoogleDriveError(f"Drive refused the {what}: {_json_or_text(r)}")


def create_folder(access_token: str, *, name: str, parent_id: str, client: Optional[httpx.Client] = None) -> dict:
    """A new folder inside `parent_id`; returns Drive's `{id, name, webViewLink}`."""
    c = client or _client()
    r = c.post(
        FILES_URL,
        params=_FOLDER_FIELDS,
        headers={"Authorization": f"Bearer {access_token}"},
        json={"name": name, "mimeType": FOLDER_MIME, "parents": [parent_id]},
    )
    return _folder_result(r, "folder")


def rename_folder(access_token: str, folder_id: str, *, name: str, client: Optional[httpx.Client] = None) -> dict:
    """Only the name changes; returns the folder as `create_folder` does."""
    c = client or _client()
    r = c.patch(
        f"{FILES_URL}/{folder_id}",
        params=_FOLDER_FIELDS,
        headers={"Authorization": f"Bearer {access_token}"},
        json={"name": name},
    )
    return _folder_result(r, "rename")


# ─── Drive upload ─────────────────────────────────────────────────────────────

def start_resumable_upload(
    access_token: str, *, name: str, mime_type: str, size: int, parent_id: str,
    client: Optional[httpx.Client] = None,
) -> str:
    """Open a resumable upload session; returns its URI."""
    c = client or _client()
    r = c.post(
        UPLOAD_URL,
        params={"uploadType": "resumable", "fields": "id,name,webViewLink", "supportsAllDrives": "true"},
        headers={
            "Authorization": f"Bearer {access_token}",
            "X-Upload-Content-Type": mime_type or "application/octet-stream",
            "X-Upload-Content-Length": str(size),
        },
        json={"name": name, "parents": [parent_id]},
    )
    if r.status_code == 401:
        raise GoogleAuthError("Google account disconnected: reconnect it in Settings → Profile")
    if r.status_code != 200:
        raise GoogleDriveError(f"Drive refused the upload: {_json_or_text(r)}")
    uri = r.headers.get("Location")
    if not uri:
        raise GoogleDriveError("Drive did not open an upload session")
    return uri


def _received_up_to(range_header: Optional[str]) -> int:
    """The next byte Drive wants, from a `Range: bytes=0-N` header (none: 0)."""
    if not range_header or "-" not in range_header:
        return 0
    try:
        return int(range_header.split("-")[-1]) + 1
    except ValueError:
        return 0


def _query_status(c: httpx.Client, session_uri: str, total: int) -> tuple[int, Optional[dict]]:
    r = c.put(session_uri, headers={"Content-Range": f"bytes */{total}", "Content-Length": "0"})
    if r.status_code in (200, 201):
        return total, r.json()
    if r.status_code == 308:
        return _received_up_to(r.headers.get("Range")), None
    if r.status_code == 404:
        raise GoogleDriveError("The Drive upload session expired; send the file again")
    if r.status_code in _RETRYABLE:
        raise _Transient()
    raise GoogleDriveError(f"Drive upload failed: {_json_or_text(r)}")


def upload_resumable(
    session_uri: str,
    chunks: Iterable[bytes],
    total: int,
    *,
    on_progress: Optional[Callable[[int], None]] = None,
    client: Optional[httpx.Client] = None,
    sleep: Callable[[float], None] = time.sleep,
) -> dict:
    """Send `chunks` (any sizes) through the session; returns the file metadata.

    Pieces are re-cut to CHUNK_SIZE as Drive requires, and each one is sent
    until Drive confirms it has it: a 308 that reports fewer bytes, a 5xx or a
    dropped connection means asking where the upload stands and sending the
    rest of the piece again, with backoff. A 4xx, other than those, ends it.
    """
    c = client or _client()
    offset = 0
    buf = bytearray()

    def send_piece(piece: bytes, start: int) -> Optional[dict]:
        """Deliver `piece` from `start` until Drive has all of it."""
        nonlocal offset
        attempt = 0
        while True:
            end = start + len(piece) - 1
            try:
                r = c.put(
                    session_uri,
                    content=piece,
                    headers={"Content-Length": str(len(piece)), "Content-Range": f"bytes {start}-{end}/{total}"},
                )
                if r.status_code in (200, 201):
                    offset = total
                    return r.json()
                if r.status_code == 308:
                    got = _received_up_to(r.headers.get("Range"))
                elif r.status_code in _RETRYABLE:
                    raise _Transient()
                elif r.status_code == 401:
                    raise GoogleAuthError("Google account disconnected: reconnect it in Settings → Profile")
                elif r.status_code == 404:
                    raise GoogleDriveError("The Drive upload session expired; send the file again")
                else:
                    raise GoogleDriveError(f"Drive upload failed: {_json_or_text(r)}")
            except (_Transient, httpx.TransportError) as exc:
                attempt += 1
                if attempt > len(_BACKOFF_SECONDS):
                    raise GoogleDriveError("Drive stopped answering during the upload") from exc
                sleep(_BACKOFF_SECONDS[attempt - 1])
                try:
                    got, done = _query_status(c, session_uri, total)
                except _Transient:
                    continue
                if done is not None:
                    offset = total
                    return done
            if got >= end + 1:
                offset = end + 1
                return None
            # Drive kept only part of it: send the rest from where it stands.
            piece = piece[got - start:]
            start = got

    result: Optional[dict] = None
    last_percent = -1

    def report():
        nonlocal last_percent
        if on_progress is None or total <= 0:
            return
        percent = min(100, int(offset * 100 / total))
        if percent > last_percent:
            last_percent = percent
            on_progress(percent)

    for chunk in chunks:
        buf.extend(chunk)
        while len(buf) >= CHUNK_SIZE:
            piece = bytes(buf[:CHUNK_SIZE])
            del buf[:CHUNK_SIZE]
            result = send_piece(piece, offset)
            report()
            if result is not None:
                return result
    if buf or total == 0:
        result = send_piece(bytes(buf), offset)
        report()
    if result is None:
        # Everything was sent but Drive never answered 200: ask once more.
        got, done = _query_status(c, session_uri, total)
        if done is None:
            raise GoogleDriveError("Drive did not confirm the upload")
        result = done
    return result
