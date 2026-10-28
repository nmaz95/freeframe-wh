"""GET /projects/{id}/assets with include_subfolders and status_id: the folder
scope and the status clause behind the sidebar's status filter."""
import uuid
from unittest.mock import MagicMock

import apps.api.routers.assets as assets_module
from apps.api.routers.assets import _folder_scope, _status_clause


def _descendants(recorder, children):
    def fake(db, folder_id):
        recorder.append(folder_id)
        return children
    return fake


def test_folder_scope_covers_the_folder_and_what_is_below_it(mock_db, monkeypatch):
    f, c1, c2 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    asked = []
    monkeypatch.setattr(assets_module, "_get_descendant_ids", _descendants(asked, [c1, c2]))

    assert _folder_scope(mock_db, str(f), True) == [f, c1, c2]
    assert asked == [f]
    assert _folder_scope(mock_db, str(f), False) == [f]
    assert asked == [f]  # not asked again without the flag


def test_folder_scope_root_and_absent(mock_db, monkeypatch):
    monkeypatch.setattr(assets_module, "_get_descendant_ids", _descendants([], [uuid.uuid4()]))

    assert _folder_scope(mock_db, "root", False) == []        # the root level only
    assert _folder_scope(mock_db, "root", True) is None       # root + below = everything
    assert _folder_scope(mock_db, None, True) is None
    assert _folder_scope(mock_db, None, False) is None


def test_status_clause_for_the_default_also_matches_no_status(mock_db, monkeypatch):
    default = MagicMock()
    default.id = uuid.uuid4()
    monkeypatch.setattr(assets_module, "get_default_status", lambda db: default)

    clause = str(_status_clause(mock_db, default.id))
    assert "assets.status_id IS NULL" in clause
    assert "assets.status_id = " in clause


def test_status_clause_for_another_status_is_an_equality(mock_db, monkeypatch):
    default = MagicMock()
    default.id = uuid.uuid4()
    monkeypatch.setattr(assets_module, "get_default_status", lambda db: default)

    clause = str(_status_clause(mock_db, uuid.uuid4()))
    assert clause == "assets.status_id = :status_id_1"


def test_status_clause_without_a_default_configured(mock_db, monkeypatch):
    monkeypatch.setattr(assets_module, "get_default_status", lambda db: None)
    assert str(_status_clause(mock_db, uuid.uuid4())) == "assets.status_id = :status_id_1"


def test_list_with_include_subfolders_asks_for_the_descendants(
    client, auth_headers, mock_db, monkeypatch,
):
    project_id, folder = uuid.uuid4(), uuid.uuid4()
    asked = []
    monkeypatch.setattr(assets_module, "require_project_visible", lambda db, pid, u: None)
    monkeypatch.setattr(assets_module, "_get_descendant_ids", _descendants(asked, []))
    monkeypatch.setattr(assets_module, "_build_asset_responses_bulk", lambda assets, db: [])
    mock_db.all.return_value = []

    resp = client.get(
        f"/projects/{project_id}/assets?folder_id={folder}&include_subfolders=true",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == []
    assert asked == [folder]

    resp = client.get(f"/projects/{project_id}/assets?folder_id={folder}", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert asked == [folder]  # without the flag the subtree is not walked


def test_list_refuses_a_malformed_status_id(client, auth_headers, mock_db, monkeypatch):
    monkeypatch.setattr(assets_module, "require_project_visible", lambda db, pid, u: None)
    resp = client.get(f"/projects/{uuid.uuid4()}/assets?status_id=not-a-uuid", headers=auth_headers)
    assert resp.status_code == 422
