"""routers/integrations.py with the mock session: connecting a Google
account, the Picker's config, and queueing a delivery."""
import uuid
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

import apps.api.routers.integrations as integ
from apps.api.models.integration import DriveDelivery, GoogleConnection
from apps.api.tests.conftest import _make_user


@pytest.fixture
def enabled(monkeypatch):
    for name, value in (
        ("google_oauth_client_id", "cid"), ("google_oauth_client_secret", "sec"),
        ("google_oauth_redirect_uri", "https://ff.example/api/integrations/google/callback"),
        ("google_api_key", "key"), ("google_app_id", "123456"),
    ):
        monkeypatch.setattr(integ.settings, name, value)
    monkeypatch.setattr(integ.settings, "frontend_url", "https://ff.example")


def _conn(user_id):
    c = MagicMock(spec=GoogleConnection)
    c.user_id = user_id
    c.google_email = "me@example.com"
    c.refresh_token_encrypted = "enc"
    c.updated_at = None
    return c


def test_status_reports_disabled_without_keys(client, auth_headers, mock_db, monkeypatch):
    monkeypatch.setattr(integ.settings, "google_oauth_client_id", "")
    body = client.get("/integrations/google", headers=auth_headers).json()
    assert body == {"enabled": False, "connected": False, "email": None, "connected_at": None}


def test_status_reports_the_connected_account(client, auth_headers, mock_db, test_user, enabled):
    mock_db.first.return_value = _conn(test_user.id)
    body = client.get("/integrations/google", headers=auth_headers).json()
    assert body["enabled"] is True and body["connected"] is True and body["email"] == "me@example.com"


def test_authorize_issues_a_single_use_state_for_this_user(client, auth_headers, mock_db, test_user, enabled, monkeypatch):
    stored = {}
    monkeypatch.setattr(integ, "store_oauth_state", lambda nonce, uid: stored.update({nonce: uid}))
    resp = client.post("/integrations/google/authorize", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    url = resp.json()["url"]
    [nonce] = list(stored)
    assert stored[nonce] == str(test_user.id)
    assert f"state={nonce}" in url and url.startswith("https://accounts.google.com/")


def test_authorize_is_refused_when_not_configured(client, auth_headers, mock_db, monkeypatch):
    monkeypatch.setattr(integ.settings, "google_api_key", "")
    assert client.post("/integrations/google/authorize", headers=auth_headers).status_code == 503


def test_callback_with_an_unknown_state_goes_back_with_an_error(client, mock_db, enabled, monkeypatch):
    monkeypatch.setattr(integ, "pop_oauth_state", lambda nonce: None)
    resp = client.get("/integrations/google/callback?state=nope&code=abc", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == "https://ff.example/settings/profile?google=error&reason=state"
    mock_db.add.assert_not_called()


def test_callback_stores_the_encrypted_refresh_token_and_the_email(client, mock_db, enabled, monkeypatch):
    user = _make_user(email="u@example.com", name="U")
    monkeypatch.setattr(integ, "pop_oauth_state", lambda nonce: str(user.id) if nonce == "good" else None)
    monkeypatch.setattr(integ.google_drive, "exchange_code", lambda code: {"access_token": "at", "refresh_token": "rt-secret", "scope": "drive.file"})
    monkeypatch.setattr(integ.google_drive, "userinfo", lambda at: {"email": "me@gmail.com"})
    # 1) the user, 2) no existing connection
    mock_db.first.side_effect = [user, None]

    resp = client.get("/integrations/google/callback?state=good&code=abc", follow_redirects=False)

    assert resp.status_code == 302
    assert resp.headers["location"].endswith("?google=connected")
    [conn] = [a for (a,), _ in mock_db.add.call_args_list if isinstance(a, GoogleConnection)]
    assert conn.user_id == user.id and conn.google_email == "me@gmail.com"
    assert conn.refresh_token_encrypted != "rt-secret"
    assert integ.decrypt_secret(conn.refresh_token_encrypted) == "rt-secret"
    mock_db.commit.assert_called_once()


def test_callback_without_a_refresh_token_does_not_connect(client, mock_db, enabled, monkeypatch):
    user = _make_user()
    monkeypatch.setattr(integ, "pop_oauth_state", lambda nonce: str(user.id))
    monkeypatch.setattr(integ.google_drive, "exchange_code", lambda code: {"access_token": "at"})
    mock_db.first.side_effect = [user]
    resp = client.get("/integrations/google/callback?state=s&code=abc", follow_redirects=False)
    assert resp.headers["location"].endswith("reason=no_refresh_token")
    mock_db.commit.assert_not_called()


def test_picker_config_needs_a_root_folder_and_a_connection(client, auth_headers, mock_db, test_user, enabled, monkeypatch):
    settings_row = MagicMock(); settings_row.drive_root_folder_id = None
    mock_db.first.side_effect = [settings_row]
    assert client.get("/integrations/google/picker", headers=auth_headers).status_code == 409

    settings_row.drive_root_folder_id = "root-1"; settings_row.drive_root_folder_name = "Consegne"
    mock_db.first.side_effect = [settings_row, None]
    assert client.get("/integrations/google/picker", headers=auth_headers).status_code == 409

    mock_db.first.side_effect = [settings_row, _conn(test_user.id)]
    monkeypatch.setattr(integ, "decrypt_secret", lambda enc: "rt")
    monkeypatch.setattr(integ.google_drive, "refresh_access_token", lambda rt: {"access_token": "at", "expires_in": 100})
    body = client.get("/integrations/google/picker", headers=auth_headers).json()
    assert body == {"access_token": "at", "expires_in": 100, "api_key": "key", "app_id": "123456",
                    "root_folder_id": "root-1", "root_folder_name": "Consegne"}


def _asset(name="Spot 30s", project_id=None):
    a = MagicMock(); a.id = uuid.uuid4(); a.project_id = project_id or uuid.uuid4(); a.name = name; a.deleted_at = None
    return a


def _media(version_number=3, original="spot_final.mov"):
    media_file = MagicMock(); media_file.version_id = uuid.uuid4(); media_file.s3_key_raw = "raw/x/spot.mov"
    media_file.original_filename = original
    version = MagicMock(); version.id = media_file.version_id; version.version_number = version_number
    return media_file, version


def test_create_delivery_checks_role_connection_and_queues(client, auth_headers, mock_db, test_user, enabled, monkeypatch):
    asset = _asset()
    body = {"folder_id": "f-1", "folder_name": "Consegne / Barilla"}

    def refuse(db, pid, u, r):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")
    monkeypatch.setattr(integ, "require_project_role", refuse)
    mock_db.first.side_effect = [asset]
    assert client.post(f"/assets/{asset.id}/deliveries", headers=auth_headers, json=body).status_code == 403

    monkeypatch.setattr(integ, "require_project_role", lambda db, pid, u, r: None)
    mock_db.first.side_effect = [asset, None]  # no Google connection
    assert client.post(f"/assets/{asset.id}/deliveries", headers=auth_headers, json=body).status_code == 409

    media_file, version = _media()
    monkeypatch.setattr(integ, "_ready_media_file", lambda db, aid, vid, u: (asset, media_file))
    dispatched = []
    monkeypatch.setattr(integ, "send_task_safe", lambda task, *a, **k: dispatched.append((task.name, a)))
    mock_db.first.side_effect = [asset, _conn(test_user.id)]
    mock_db.all.side_effect = [[asset], [version]]

    resp = client.post(f"/assets/{asset.id}/deliveries", headers=auth_headers, json=body)

    assert resp.status_code == 201, resp.text
    out = resp.json()
    assert out["file_name"] == "Spot 30s v3.mov"
    assert out["status"] == "queued" and out["folder_name"] == "Consegne / Barilla"
    [rows] = [a for (a,), _ in mock_db.add_all.call_args_list]
    [row] = rows
    assert isinstance(row, DriveDelivery)
    assert row.user_id == test_user.id and row.version_id == media_file.version_id
    assert dispatched == [("apps.api.tasks.drive_tasks.deliver_to_drive", (str(row.id),))]
    mock_db.commit.assert_called_once()


@pytest.fixture
def batch(mock_db, test_user, monkeypatch):
    """Two assets of one project, editor role granted, a connection, tasks recorded."""
    project_id = uuid.uuid4()
    a, b = _asset("Clip A", project_id), _asset("Clip B", project_id)
    media = {a.id: _media(3, "a.mov"), b.id: _media(1, "b.mp4")}
    monkeypatch.setattr(integ, "require_project_role", lambda db, pid, u, r: None)
    monkeypatch.setattr(integ, "_ready_media_file", lambda db, aid, vid, u: (None, media[aid][0]))
    dispatched = []
    monkeypatch.setattr(integ, "send_task_safe", lambda task, *x, **k: dispatched.append(x[0]))
    mock_db.first.side_effect = [_conn(test_user.id)]
    mock_db.all.side_effect = [[a, b], [media[a.id][1], media[b.id][1]]]
    return project_id, a, b, media, dispatched


def test_batch_delivery_queues_one_row_per_asset_in_request_order(client, auth_headers, mock_db, enabled, batch):
    project_id, a, b, media, dispatched = batch
    body = {"folder_id": "f-1", "folder_name": "Consegne / Barilla", "items": [
        {"asset_id": str(b.id), "file_name": " B / final "},
        {"asset_id": str(a.id)},
        {"asset_id": str(b.id), "file_name": "ignored duplicate"},
    ]}
    resp = client.post(f"/projects/{project_id}/deliveries", headers=auth_headers, json=body)
    assert resp.status_code == 201, resp.text
    out = resp.json()
    assert [d["asset_id"] for d in out] == [str(b.id), str(a.id)]
    assert [d["file_name"] for d in out] == ["B - final", "Clip A v3.mov"]
    assert [d["version_number"] for d in out] == [1, 3]
    assert all(d["status"] == "queued" and d["folder_name"] == "Consegne / Barilla" for d in out)
    assert dispatched == [d["id"] for d in out]
    mock_db.commit.assert_called_once()


def test_batch_delivery_refuses_an_asset_outside_the_project(client, auth_headers, mock_db, enabled, batch):
    project_id, a, b, media, dispatched = batch
    mock_db.all.side_effect = [[a]]  # b is elsewhere, or gone
    body = {"folder_id": "f-1", "folder_name": "Consegne", "items": [{"asset_id": str(a.id)}, {"asset_id": str(b.id)}]}
    resp = client.post(f"/projects/{project_id}/deliveries", headers=auth_headers, json=body)
    assert resp.status_code == 404
    mock_db.add_all.assert_not_called()
    mock_db.commit.assert_not_called()
    assert dispatched == []


def test_batch_delivery_names_the_asset_whose_version_is_not_ready(client, auth_headers, mock_db, enabled, batch, monkeypatch):
    project_id, a, b, media, dispatched = batch

    def ready(db, aid, vid, u):
        if aid == b.id:
            raise HTTPException(status_code=409, detail="Asset version is not ready yet")
        return None, media[aid][0]
    monkeypatch.setattr(integ, "_ready_media_file", ready)
    body = {"folder_id": "f-1", "folder_name": "Consegne", "items": [{"asset_id": str(a.id)}, {"asset_id": str(b.id)}]}
    resp = client.post(f"/projects/{project_id}/deliveries", headers=auth_headers, json=body)
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Clip B: Asset version is not ready yet"
    mock_db.add_all.assert_not_called()
    assert dispatched == []


def test_batch_delivery_checks_the_role_once_and_the_connection(client, auth_headers, mock_db, enabled, monkeypatch):
    project_id = uuid.uuid4()
    body = {"folder_id": "f-1", "folder_name": "Consegne", "items": [{"asset_id": str(uuid.uuid4())}]}
    checks = []

    def refuse(db, pid, u, r):
        checks.append(pid)
        raise HTTPException(status_code=403, detail="Requires editor role or higher")
    monkeypatch.setattr(integ, "require_project_role", refuse)
    assert client.post(f"/projects/{project_id}/deliveries", headers=auth_headers, json=body).status_code == 403
    assert checks == [project_id]

    monkeypatch.setattr(integ, "require_project_role", lambda db, pid, u, r: None)
    mock_db.first.side_effect = [None]
    assert client.post(f"/projects/{project_id}/deliveries", headers=auth_headers, json=body).status_code == 409

    too_many = {**body, "items": [{"asset_id": str(uuid.uuid4())} for _ in range(101)]}
    assert client.post(f"/projects/{project_id}/deliveries", headers=auth_headers, json=too_many).status_code == 422
    assert client.post(f"/projects/{project_id}/deliveries", headers=auth_headers, json={**body, "items": []}).status_code == 422


def test_list_project_deliveries_by_ids(client, auth_headers, mock_db, enabled, monkeypatch):
    project_id = uuid.uuid4()
    seen = []
    monkeypatch.setattr(integ, "require_project_visible", lambda db, pid, u: seen.append(pid))
    d1, d2 = MagicMock(spec=DriveDelivery), MagicMock(spec=DriveDelivery)
    for d in (d1, d2):
        d.id = uuid.uuid4(); d.asset_id = uuid.uuid4(); d.version_id = uuid.uuid4(); d.user_id = uuid.uuid4()
        d.folder_id = "f"; d.folder_name = "Consegne / X"; d.file_name = "x.mov"; d.status = "done"
        d.progress_percent = 100; d.drive_file_id = "g"; d.web_view_link = None; d.error = None
        d.created_at = None; d.updated_at = None
    mock_db.join.return_value = mock_db
    mock_db.outerjoin.return_value = mock_db
    mock_db.all.return_value = [(d1, "Me", 3), (d2, "Me", 1)]
    missing = uuid.uuid4()

    resp = client.get(f"/projects/{project_id}/deliveries?ids={d2.id},{missing},{d1.id}", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert [d["id"] for d in resp.json()] == [str(d2.id), str(d1.id)]
    assert seen == [project_id]

    assert client.get(f"/projects/{project_id}/deliveries?ids=not-an-id", headers=auth_headers).status_code == 400
    assert client.get(f"/projects/{project_id}/deliveries?ids=", headers=auth_headers).status_code == 400
    many = ",".join(str(uuid.uuid4()) for _ in range(101))
    assert client.get(f"/projects/{project_id}/deliveries?ids={many}", headers=auth_headers).status_code == 400


def test_create_folder_creates_under_the_parent_as_the_user(client, auth_headers, mock_db, enabled, monkeypatch):
    monkeypatch.setattr(integ, "_access_token_for", lambda db, u: "at")
    calls = []

    def create(token, *, name, parent_id):
        calls.append((token, name, parent_id))
        return {"id": "f-new", "name": name, "webViewLink": "https://drive.google.com/drive/folders/f-new"}
    monkeypatch.setattr(integ.google_drive, "create_folder", create)

    resp = client.post("/integrations/google/folders", headers=auth_headers, json={"parent_id": "f-barilla", "name": " Spot / Final "})
    assert resp.status_code == 201, resp.text
    assert resp.json() == {"id": "f-new", "name": "Spot - Final", "web_view_link": "https://drive.google.com/drive/folders/f-new"}
    assert calls == [("at", "Spot - Final", "f-barilla")]

    assert client.post("/integrations/google/folders", headers=auth_headers, json={"parent_id": "f", "name": "   "}).status_code == 422


def test_create_folder_turns_an_unseen_parent_into_pick_it_again(client, auth_headers, mock_db, enabled, monkeypatch):
    monkeypatch.setattr(integ, "_access_token_for", lambda db, u: "at")

    def missing(token, **kw):
        raise integ.google_drive.GoogleFolderNotFound("nope")
    monkeypatch.setattr(integ.google_drive, "create_folder", missing)
    resp = client.post("/integrations/google/folders", headers=auth_headers, json={"parent_id": "root", "name": "Barilla"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "FreeFrame can't see that folder with your Google account; pick it again with Choose folder"

    def down(token, **kw):
        raise integ.google_drive.GoogleDriveError("Drive refused the folder: quota")
    monkeypatch.setattr(integ.google_drive, "create_folder", down)
    assert client.post("/integrations/google/folders", headers=auth_headers, json={"parent_id": "root", "name": "Barilla"}).status_code == 502


def test_rename_folder_patches_the_name_and_validates_the_id(client, auth_headers, mock_db, enabled, monkeypatch):
    monkeypatch.setattr(integ, "_access_token_for", lambda db, u: "at")
    calls = []

    def rename(token, folder_id, *, name):
        calls.append((token, folder_id, name))
        return {"id": folder_id, "name": name}
    monkeypatch.setattr(integ.google_drive, "rename_folder", rename)

    resp = client.patch("/integrations/google/folders/f-new", headers=auth_headers, json={"name": "Final"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"id": "f-new", "name": "Final", "web_view_link": None}
    assert calls == [("at", "f-new", "Final")]
    assert client.patch("/integrations/google/folders/f.1", headers=auth_headers, json={"name": "Final"}).status_code == 422
