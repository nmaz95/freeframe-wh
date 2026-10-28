"""GET /projects/{id}/assets/status-counts: the numbers beside the sidebar's
statuses, counted over the folder and every folder below it."""
import uuid
from unittest.mock import MagicMock

import apps.api.routers.assets as assets_module


def _status(id_=None):
    s = MagicMock()
    s.id = id_ or uuid.uuid4()
    return s


def _asset(status_id):
    a = MagicMock()
    a.id = uuid.uuid4()
    a.status_id = status_id
    return a


def test_counts_fold_missing_and_unknown_statuses_into_the_default(
    client, auth_headers, mock_db, monkeypatch,
):
    project_id = uuid.uuid4()
    default, s1 = _status(), _status()
    calls = []

    def rows(db, pid, **kw):
        calls.append((pid, kw))
        return [_asset(s1.id), _asset(s1.id), _asset(None), _asset(uuid.uuid4())]

    monkeypatch.setattr(assets_module, "require_project_visible", lambda db, pid, u: None)
    monkeypatch.setattr(assets_module, "_list_asset_rows", rows)
    monkeypatch.setattr(assets_module, "live_statuses", lambda db: [default, s1])
    monkeypatch.setattr(assets_module, "get_default_status", lambda db: default)

    resp = client.get(f"/projects/{project_id}/assets/status-counts?folder_id=root", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"counts": {str(s1.id): 2, str(default.id): 2}}
    assert calls == [(project_id, {
        "folder_id": "root", "include_subfolders": True, "include_failed": False, "status_id": None,
    })]


def test_counts_without_a_default_skip_assets_with_no_status(client, auth_headers, mock_db, monkeypatch):
    s1 = _status()
    monkeypatch.setattr(assets_module, "require_project_visible", lambda db, pid, u: None)
    monkeypatch.setattr(assets_module, "_list_asset_rows", lambda db, pid, **kw: [_asset(s1.id), _asset(None)])
    monkeypatch.setattr(assets_module, "live_statuses", lambda db: [s1])
    monkeypatch.setattr(assets_module, "get_default_status", lambda db: None)

    resp = client.get(f"/projects/{uuid.uuid4()}/assets/status-counts", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"counts": {str(s1.id): 1}}


def test_counts_need_access_to_the_project(client, auth_headers, mock_db, monkeypatch):
    from fastapi import HTTPException

    def refuse(db, pid, u):
        raise HTTPException(status_code=404, detail="Project not found")

    monkeypatch.setattr(assets_module, "require_project_visible", refuse)
    resp = client.get(f"/projects/{uuid.uuid4()}/assets/status-counts", headers=auth_headers)
    assert resp.status_code == 404
