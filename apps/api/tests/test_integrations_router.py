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


def test_create_delivery_checks_role_connection_and_queues(client, auth_headers, mock_db, test_user, enabled, monkeypatch):
    asset = MagicMock(); asset.id = uuid.uuid4(); asset.project_id = uuid.uuid4(); asset.name = "Spot 30s"; asset.deleted_at = None
    body = {"folder_id": "f-1", "folder_name": "Consegne / Barilla"}

    def refuse(db, pid, u, r):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")
    monkeypatch.setattr(integ, "require_project_role", refuse)
    mock_db.first.side_effect = [asset]
    assert client.post(f"/assets/{asset.id}/deliveries", headers=auth_headers, json=body).status_code == 403

    monkeypatch.setattr(integ, "require_project_role", lambda db, pid, u, r: None)
    mock_db.first.side_effect = [asset, None]  # no Google connection
    assert client.post(f"/assets/{asset.id}/deliveries", headers=auth_headers, json=body).status_code == 409

    media_file = MagicMock(); media_file.version_id = uuid.uuid4(); media_file.s3_key_raw = "raw/x/spot.mov"; media_file.original_filename = "spot_final.mov"
    version = MagicMock(); version.version_number = 3
    monkeypatch.setattr(integ, "_ready_media_file", lambda db, aid, vid, u: (asset, media_file))
    dispatched = []
    monkeypatch.setattr(integ, "send_task_safe", lambda task, *a, **k: dispatched.append((task.name, a)))
    mock_db.first.side_effect = [asset, _conn(test_user.id), version]

    resp = client.post(f"/assets/{asset.id}/deliveries", headers=auth_headers, json=body)

    assert resp.status_code == 201, resp.text
    out = resp.json()
    assert out["file_name"] == "Spot 30s v3.mov"
    assert out["status"] == "queued" and out["folder_name"] == "Consegne / Barilla"
    [row] = [a for (a,), _ in mock_db.add.call_args_list if isinstance(a, DriveDelivery)]
    assert row.user_id == test_user.id and row.version_id == media_file.version_id
    assert dispatched == [("apps.api.tasks.drive_tasks.deliver_to_drive", (str(row.id),))]
