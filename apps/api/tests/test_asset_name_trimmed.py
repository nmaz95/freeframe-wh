"""An asset name is stored without leading or trailing whitespace.

"Carron - Firenze " (trailing space) reached the database through
POST /upload/initiate and, in the review page, made a tab title that never
read back as written -- the browser canonicalises `document.title` -- so the
title hold rewrote it without end and the tab froze. The client is fixed to
converge anyway; this keeps such a name from being stored in the first place,
on upload and on rename alike.
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

import apps.api.routers.assets as assets_module
import apps.api.routers.upload as upload_module
from apps.api.schemas.asset import AssetResponse, AssetUpdate
from apps.api.schemas.upload import InitiateUploadRequest, clean_asset_name


def _initiate_body(**overrides):
    body = {
        "project_id": str(uuid.uuid4()),
        "mime_type": "video/mp4",
        "original_filename": "carron.mp4",
        "file_size_bytes": 10,
        "asset_name": "Carron - Firenze ",
    }
    body.update(overrides)
    return body


# ─── The rule itself ──────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "raw, expected",
    [
        ("Carron - Firenze ", "Carron - Firenze"),
        ("  Reel - 67", "Reel - 67"),
        ("\tSpot 30s\n", "Spot 30s"),
        # Inner whitespace is the user's; only the ends go.
        ("Carron  -  Firenze", "Carron  -  Firenze"),
    ],
)
def test_clean_asset_name_strips_the_ends_only(raw, expected):
    assert clean_asset_name(raw) == expected


def test_initiate_request_stores_the_trimmed_name():
    req = InitiateUploadRequest(**_initiate_body())
    assert req.asset_name == "Carron - Firenze"


def test_initiate_request_falls_back_to_the_file_name_for_a_blank_name():
    req = InitiateUploadRequest(**_initiate_body(asset_name="   ", original_filename=" carron.mp4 "))
    assert req.asset_name == "carron.mp4"


def test_initiate_request_refuses_a_name_that_is_blank_with_no_file_name():
    with pytest.raises(ValidationError, match="cannot be empty"):
        InitiateUploadRequest(**_initiate_body(asset_name="   ", original_filename=" "))


def test_update_trims_the_name_and_refuses_a_blank_one():
    assert AssetUpdate(name=" Carron - Firenze ").name == "Carron - Firenze"
    assert AssetUpdate(description="x").name is None
    with pytest.raises(ValidationError, match="cannot be empty"):
        AssetUpdate(name="  ")


# ─── Through the routes ───────────────────────────────────────────────────────

def test_initiate_upload_creates_the_asset_with_the_trimmed_name(
    client, auth_headers, mock_db, test_user, monkeypatch
):
    monkeypatch.setattr(upload_module, "upload_guard_error", lambda db, n: None)
    monkeypatch.setattr(upload_module, "choose_part_size", lambda db, n: (10 * 1024 * 1024, None))
    monkeypatch.setattr(upload_module, "require_project_role", lambda db, pid, u, r: None)
    monkeypatch.setattr(upload_module, "get_default_status", lambda db: None)
    monkeypatch.setattr(upload_module, "next_version_number", lambda db, aid: 1)
    monkeypatch.setattr(upload_module, "create_multipart_upload", lambda key, mime: "u1")
    project = MagicMock()
    project.id = uuid.uuid4()
    mock_db.first.side_effect = [project]
    # The mock session's flush does not assign ids; the route reads them.
    mock_db.flush.side_effect = lambda: [
        setattr(a, "id", uuid.uuid4()) for (a,), _ in mock_db.add.call_args_list if a.id is None
    ]

    resp = client.post("/upload/initiate", json=_initiate_body(), headers=auth_headers)

    assert resp.status_code == 200, resp.text
    added = [a for (a,), _ in mock_db.add.call_args_list]
    [asset] = [a for a in added if isinstance(a, upload_module.Asset)]
    assert asset.name == "Carron - Firenze"


def _fake_response(asset, db):
    return AssetResponse(
        id=asset.id, project_id=asset.project_id, name=asset.name, description=None,
        asset_type="video", status="draft", status_id=None, rating=None,
        assignee_id=None, due_date=None, keywords=[], created_by=asset.created_by,
        created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
    )


def test_patch_asset_stores_the_trimmed_name(client, auth_headers, mock_db, test_user, monkeypatch):
    monkeypatch.setattr(assets_module, "require_project_role", lambda db, pid, u, r: None)
    monkeypatch.setattr(assets_module, "_build_asset_response", _fake_response)
    asset = MagicMock()
    asset.id = uuid.uuid4()
    asset.project_id = uuid.uuid4()
    asset.created_by = test_user.id
    mock_db.first.side_effect = [asset]

    resp = client.patch(f"/assets/{asset.id}", headers=auth_headers, json={"name": "Carron - Firenze "})

    assert resp.status_code == 200, resp.text
    assert asset.name == "Carron - Firenze"


def test_patch_asset_refuses_a_blank_name(client, auth_headers, mock_db, test_user, monkeypatch):
    monkeypatch.setattr(assets_module, "require_project_role", lambda db, pid, u, r: None)
    resp = client.patch(f"/assets/{uuid.uuid4()}", headers=auth_headers, json={"name": "   "})
    assert resp.status_code == 422
    assert "cannot be empty" in resp.text
    mock_db.commit.assert_not_called()
