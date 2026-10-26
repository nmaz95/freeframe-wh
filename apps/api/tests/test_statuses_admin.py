"""Admin management of asset statuses and pipeline roles (routers/statuses.py)."""
import uuid
from unittest.mock import MagicMock

from apps.api.models.pipeline import AssetStatusDef, PipelineRole


def _status(**over):
    row = MagicMock(spec=AssetStatusDef)
    row.id = over.get("id", uuid.uuid4())
    row.name = over.get("name", "Needs PM Review")
    row.color = over.get("color", "#3b82f6")
    row.position = over.get("position", 1)
    row.is_default = over.get("is_default", False)
    row.notify_creator = over.get("notify_creator", True)
    row.notify_assignee = over.get("notify_assignee", False)
    row.legacy_key = over.get("legacy_key", None)
    row.deleted_at = None
    return row


def test_list_statuses_is_open_to_members_and_ordered(client, auth_headers, mock_db, test_user):
    test_user.is_superadmin = False
    mock_db.order_by.return_value = mock_db
    first, second = _status(name="No Status", position=0, is_default=True, legacy_key="draft"), _status(position=1)
    mock_db.all.return_value = [first, second]

    resp = client.get("/statuses", headers=auth_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert [s["name"] for s in body] == ["No Status", "Needs PM Review"]
    assert body[0]["is_default"] is True
    assert body[0]["legacy_key"] == "draft"
    assert body[1]["notify_role_ids"] == []


def test_create_status_requires_admin(client, auth_headers, mock_db, test_user):
    test_user.is_superadmin = False
    resp = client.post("/statuses", headers=auth_headers, json={"name": "X", "color": "#112233"})
    assert resp.status_code == 403
    mock_db.add.assert_not_called()


def test_create_status_validates_name_and_color(client, auth_headers, mock_db, test_user):
    test_user.is_superadmin = True
    assert client.post("/statuses", headers=auth_headers, json={"name": "X", "color": "red"}).status_code == 422
    assert client.post("/statuses", headers=auth_headers, json={"name": "   ", "color": "#112233"}).status_code == 422
    assert client.post("/statuses", headers=auth_headers, json={"name": "x" * 61, "color": "#112233"}).status_code == 422
    mock_db.add.assert_not_called()


def test_create_status_appends_after_the_last_position(client, auth_headers, mock_db, test_user):
    test_user.is_superadmin = True
    mock_db.order_by.return_value = mock_db
    mock_db.all.return_value = [_status(position=0), _status(position=4)]

    resp = client.post(
        "/statuses", headers=auth_headers,
        json={"name": "  Client   Review ", "color": "#DB2777", "notify_assignee": True},
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "Client Review"
    assert body["color"] == "#db2777"
    assert body["position"] == 5
    assert body["notify_assignee"] is True
    added = [a for (a,), _ in mock_db.add.call_args_list if isinstance(a, AssetStatusDef)]
    assert len(added) == 1 and added[0].position == 5
    mock_db.commit.assert_called_once()


def test_delete_default_status_is_refused(client, auth_headers, mock_db, test_user):
    test_user.is_superadmin = True
    mock_db.first.return_value = _status(is_default=True)

    resp = client.delete(f"/statuses/{uuid.uuid4()}", headers=auth_headers)

    assert resp.status_code == 409
    mock_db.commit.assert_not_called()


def test_delete_status_moves_its_assets_to_the_default(client, auth_headers, mock_db, test_user):
    test_user.is_superadmin = True
    doomed = _status(name="Client Review")
    default = _status(name="No Status", is_default=True, legacy_key="draft")
    # 1) the status being deleted, 2) the default it hands its assets to
    mock_db.first.side_effect = [doomed, default]

    resp = client.delete(f"/statuses/{doomed.id}", headers=auth_headers)

    assert resp.status_code == 204
    values = mock_db.update.call_args_list[0].args[0]
    assert values["status_id"] == default.id
    assert values["status"].value == "draft"
    assert doomed.deleted_at is not None
    mock_db.commit.assert_called_once()


def test_patch_is_default_clears_the_previous_default(client, auth_headers, mock_db, test_user):
    test_user.is_superadmin = True
    row = _status(is_default=False)
    mock_db.first.return_value = row

    resp = client.patch(f"/statuses/{row.id}", headers=auth_headers, json={"is_default": True})

    assert resp.status_code == 200, resp.text
    assert row.is_default is True
    mock_db.update.assert_called_once_with({"is_default": False}, synchronize_session=False)


def test_patch_cannot_unset_the_only_default(client, auth_headers, mock_db, test_user):
    test_user.is_superadmin = True
    mock_db.first.return_value = _status(is_default=True)

    resp = client.patch(f"/statuses/{uuid.uuid4()}", headers=auth_headers, json={"is_default": False})

    assert resp.status_code == 409
    mock_db.commit.assert_not_called()


def test_reorder_must_name_every_status_once(client, auth_headers, mock_db, test_user):
    test_user.is_superadmin = True
    mock_db.order_by.return_value = mock_db
    a, b = _status(position=0), _status(position=1)
    mock_db.all.return_value = [a, b]

    assert client.put("/statuses/reorder", headers=auth_headers, json={"ids": [str(a.id)]}).status_code == 400

    resp = client.put("/statuses/reorder", headers=auth_headers, json={"ids": [str(b.id), str(a.id)]})
    assert resp.status_code == 200, resp.text
    assert (b.position, a.position) == (0, 1)


def test_pipeline_roles_create_is_admin_only(client, auth_headers, mock_db, test_user):
    test_user.is_superadmin = False
    assert client.post("/pipeline-roles", headers=auth_headers, json={"name": "PM"}).status_code == 403

    test_user.is_superadmin = True
    resp = client.post("/pipeline-roles", headers=auth_headers, json={"name": " PM "})
    assert resp.status_code == 201, resp.text
    assert resp.json()["name"] == "PM"
    added = [a for (a,), _ in mock_db.add.call_args_list if isinstance(a, PipelineRole)]
    assert len(added) == 1
