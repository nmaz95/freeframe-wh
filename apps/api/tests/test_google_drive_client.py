"""services/google_drive over an httpx.MockTransport: the OAuth calls and the
resumable upload, including the ways Drive asks for a chunk again."""
import json

import httpx
import pytest

from apps.api.services import google_drive as gd

KiB = 1024


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_authorization_url_asks_for_offline_consent(monkeypatch):
    monkeypatch.setattr(gd.settings, "google_oauth_client_id", "cid")
    monkeypatch.setattr(gd.settings, "google_oauth_redirect_uri", "https://ff.example/api/integrations/google/callback")
    url = gd.authorization_url("nonce-1")
    assert url.startswith(gd.AUTH_URL + "?")
    assert "client_id=cid" in url and "state=nonce-1" in url
    assert "access_type=offline" in url and "prompt=consent" in url
    assert "drive.file" in url


def test_refresh_distinguishes_a_dead_grant_from_a_hiccup():
    def dead(request):
        return httpx.Response(400, json={"error": "invalid_grant"})
    with pytest.raises(gd.GoogleAuthError):
        gd.refresh_access_token("rt", client=_client(dead))

    def hiccup(request):
        return httpx.Response(503, text="try later")
    with pytest.raises(gd.GoogleDriveError) as info:
        gd.refresh_access_token("rt", client=_client(hiccup))
    assert not isinstance(info.value, gd.GoogleAuthError)

    def ok(request):
        assert request.url == httpx.URL(gd.TOKEN_URL)
        assert b"grant_type=refresh_token" in request.content
        return httpx.Response(200, json={"access_token": "at", "expires_in": 3599})
    assert gd.refresh_access_token("rt", client=_client(ok))["access_token"] == "at"


def test_start_resumable_upload_returns_the_session_uri():
    seen = {}

    def handler(request):
        seen["headers"] = request.headers
        seen["body"] = json.loads(request.content)
        seen["params"] = dict(request.url.params)
        return httpx.Response(200, headers={"Location": "https://upload.example/session/1"})

    uri = gd.start_resumable_upload(
        "at", name="Spot v3.mov", mime_type="video/quicktime", size=12, parent_id="folder-1", client=_client(handler),
    )
    assert uri == "https://upload.example/session/1"
    assert seen["body"] == {"name": "Spot v3.mov", "parents": ["folder-1"]}
    assert seen["headers"]["x-upload-content-length"] == "12"
    assert seen["params"]["uploadType"] == "resumable"
    assert "webViewLink" in seen["params"]["fields"]


def test_create_folder_posts_the_folder_metadata():
    seen = {}

    def handler(request):
        seen["method"] = request.method
        seen["url"] = str(request.url).split("?")[0]
        seen["params"] = dict(request.url.params)
        seen["body"] = json.loads(request.content)
        seen["auth"] = request.headers["authorization"]
        return httpx.Response(200, json={"id": "f-new", "name": "Spot", "webViewLink": "https://drive.google.com/drive/folders/f-new"})

    out = gd.create_folder("at", name="Spot", parent_id="f-barilla", client=_client(handler))
    assert out["id"] == "f-new"
    assert seen["method"] == "POST" and seen["url"] == gd.FILES_URL
    assert seen["body"] == {"name": "Spot", "mimeType": gd.FOLDER_MIME, "parents": ["f-barilla"]}
    assert seen["params"] == {"fields": "id,name,webViewLink", "supportsAllDrives": "true"}
    assert seen["auth"] == "Bearer at"


def test_create_folder_tells_an_unseen_parent_from_a_dead_grant():
    def gone(request):
        return httpx.Response(404, json={"error": {"message": "File not found: root"}})
    with pytest.raises(gd.GoogleFolderNotFound):
        gd.create_folder("at", name="X", parent_id="root", client=_client(gone))

    def dead(request):
        return httpx.Response(401, text="")
    with pytest.raises(gd.GoogleAuthError):
        gd.create_folder("at", name="X", parent_id="root", client=_client(dead))

    def refused(request):
        return httpx.Response(403, json={"error": {"message": "quota"}})
    with pytest.raises(gd.GoogleDriveError) as info:
        gd.create_folder("at", name="X", parent_id="root", client=_client(refused))
    assert "quota" in str(info.value) and not isinstance(info.value, gd.GoogleFolderNotFound)


def test_rename_folder_patches_only_the_name():
    seen = {}

    def handler(request):
        seen["method"] = request.method
        seen["url"] = str(request.url).split("?")[0]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "f-1", "name": "Final"})

    assert gd.rename_folder("at", "f-1", name="Final", client=_client(handler))["name"] == "Final"
    assert seen["method"] == "PATCH" and seen["url"] == f"{gd.FILES_URL}/f-1"
    assert seen["body"] == {"name": "Final"}


class _DriveSession:
    """A fake resumable session that records what it was sent and can be told
    to keep only part of a chunk, or to fail once."""

    def __init__(self, total, *, keep_short_once=None, fail_once=False):
        self.total = total
        self.received = bytearray()
        self.keep_short_once = keep_short_once
        self.fail_once = fail_once
        self.puts = []

    def handler(self, request):
        assert request.method == "PUT"
        rng = request.headers.get("Content-Range", "")
        if rng.startswith("bytes */"):
            return self._status()
        start = int(rng.split(" ")[1].split("-")[0])
        self.puts.append((start, len(request.content)))
        if self.fail_once:
            self.fail_once = False
            return httpx.Response(503, text="try again")
        body = request.content
        if self.keep_short_once is not None:
            body = body[: self.keep_short_once]
            self.keep_short_once = None
        assert start == len(self.received), "chunks must arrive in order"
        self.received.extend(body)
        return self._status()

    def _status(self):
        if len(self.received) >= self.total:
            return httpx.Response(200, json={"id": "file-1", "webViewLink": "https://drive.google.com/file/d/file-1/view"})
        headers = {"Range": f"bytes=0-{len(self.received) - 1}"} if self.received else {}
        return httpx.Response(308, headers=headers)


def _chunks(data, size):
    for i in range(0, len(data), size):
        yield data[i:i + size]


def test_upload_recuts_chunks_to_drive_size_and_reports_progress(monkeypatch):
    monkeypatch.setattr(gd, "CHUNK_SIZE", 512 * KiB)
    data = bytes(range(256)) * (5 * KiB)  # 1.25 MiB: two full pieces and a tail
    session = _DriveSession(len(data))
    seen = []
    result = gd.upload_resumable(
        "https://s/1", _chunks(data, 100 * KiB), len(data),
        on_progress=seen.append, client=_client(session.handler), sleep=lambda s: None,
    )
    assert result["id"] == "file-1"
    assert bytes(session.received) == data
    assert [n for _, n in session.puts] == [512 * KiB, 512 * KiB, 256 * KiB]
    assert seen[-1] == 100 and seen == sorted(seen)


def test_upload_resends_the_part_drive_did_not_keep(monkeypatch):
    monkeypatch.setattr(gd, "CHUNK_SIZE", 512 * KiB)
    data = b"x" * (1024 * KiB)
    session = _DriveSession(len(data), keep_short_once=256 * KiB)
    gd.upload_resumable("https://s/1", _chunks(data, 512 * KiB), len(data), client=_client(session.handler), sleep=lambda s: None)
    assert bytes(session.received) == data
    # first piece sent whole, then its missing half, then the second piece
    assert session.puts == [(0, 512 * KiB), (256 * KiB, 256 * KiB), (512 * KiB, 512 * KiB)]


def test_upload_asks_where_it_stands_after_a_503_and_carries_on(monkeypatch):
    monkeypatch.setattr(gd, "CHUNK_SIZE", 512 * KiB)
    data = b"y" * (1024 * KiB)
    session = _DriveSession(len(data), fail_once=True)
    slept = []
    gd.upload_resumable("https://s/1", _chunks(data, 512 * KiB), len(data), client=_client(session.handler), sleep=slept.append)
    assert bytes(session.received) == data
    assert slept == [1]


def test_upload_stops_on_a_dead_token_and_an_expired_session():
    def unauthorized(request):
        return httpx.Response(401, json={"error": {"message": "Invalid Credentials"}})
    with pytest.raises(gd.GoogleAuthError):
        gd.upload_resumable("https://s/1", [b"abc"], 3, client=_client(unauthorized), sleep=lambda s: None)

    def gone(request):
        return httpx.Response(404)
    with pytest.raises(gd.GoogleDriveError) as info:
        gd.upload_resumable("https://s/1", [b"abc"], 3, client=_client(gone), sleep=lambda s: None)
    assert "expired" in str(info.value)
