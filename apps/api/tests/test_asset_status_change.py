"""Moving an asset between statuses: PUT /assets/{id}/status and the legacy
`status` field of PATCH /assets/{id}, both through services.status_notifications."""
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

from fastapi import HTTPException

import apps.api.routers.assets as assets_module
import apps.api.routers.statuses as statuses_module
import apps.api.services.status_notifications as svc
from apps.api.models.activity import ActivityLog, Notification, NotificationType
from apps.api.models.asset import AssetStatus
from apps.api.models.pipeline import AssetStatusDef
from apps.api.schemas.asset import AssetResponse
from apps.api.tests.conftest import _make_user


def _status(**over):
    row = MagicMock(spec=AssetStatusDef)
    row.id = over.get("id", uuid.uuid4())
    row.name = over.get("name", "Needs PM Review")
    row.color = over.get("color", "#3b82f6")
    row.legacy_key = over.get("legacy_key", None)
    row.notify_creator = over.get("notify_creator", True)
    row.notify_assignee = over.get("notify_assignee", False)
    row.deleted_at = None
    return row


def _asset(creator, status_id):
    a = MagicMock()
    a.id = uuid.uuid4()
    a.project_id = uuid.uuid4()
    a.name = "Spot 30s"
    a.created_by = creator.id
    a.assignee_id = None
    a.status_id = status_id
    a.status = AssetStatus.draft
    a.deleted_at = None
    return a


def _fake_response(asset, db):
    return AssetResponse(
        id=asset.id, project_id=asset.project_id, name=asset.name, description=None,
        asset_type="video", status="draft", status_id=asset.status_id, rating=None,
        assignee_id=None, due_date=None, keywords=[], created_by=asset.created_by,
        created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
    )


def _wire(monkeypatch, *, role_ok=True):
    """Bypass what the mock DB cannot answer, and record the side effects."""
    events = []
    if role_ok:
        monkeypatch.setattr(statuses_module, "require_project_role", lambda db, pid, u, r: None)
    else:
        def refuse(db, pid, u, r):
            raise HTTPException(status_code=403, detail="Requires reviewer role or higher")
        monkeypatch.setattr(statuses_module, "require_project_role", refuse)
    monkeypatch.setattr(statuses_module, "_build_asset_response", _fake_response)
    monkeypatch.setattr(svc, "can_access_asset", lambda db, asset, user: True)
    monkeypatch.setattr(svc, "send_task_safe", lambda task, **kw: events.append(("email", task.name, kw)))
    monkeypatch.setattr(svc.event_service, "publish_sync", lambda pid, et, payload: events.append(("sse", et, payload)))
    return events


def test_requires_reviewer_role(client, auth_headers, mock_db, test_user, monkeypatch):
    events = _wire(monkeypatch, role_ok=False)
    creator = _make_user(email="c@t.local", name="Creator")
    asset = _asset(creator, uuid.uuid4())
    mock_db.first.side_effect = [asset]

    resp = client.put(f"/assets/{asset.id}/status", headers=auth_headers, json={"status_id": str(uuid.uuid4())})

    assert resp.status_code == 403
    mock_db.commit.assert_not_called()
    assert events == []


def test_same_status_is_a_no_op(client, auth_headers, mock_db, test_user, monkeypatch):
    events = _wire(monkeypatch)
    creator = _make_user(email="c@t.local", name="Creator")
    target = _status()
    asset = _asset(creator, target.id)
    mock_db.first.side_effect = [asset, target]

    resp = client.put(f"/assets/{asset.id}/status", headers=auth_headers, json={"status_id": str(target.id)})

    assert resp.status_code == 200, resp.text
    mock_db.add.assert_not_called()
    mock_db.commit.assert_not_called()
    assert events == []


def test_change_notifies_the_creator_in_app_and_by_email_after_the_commit(
    client, auth_headers, mock_db, test_user, monkeypatch,
):
    events = _wire(monkeypatch)
    mock_db.commit.side_effect = lambda: events.append(("commit",))
    creator = _make_user(email="c@t.local", name="Creator")
    previous = _status(name="No Status")
    target = _status(name="Needs PM Review", color="#3b82f6")
    asset = _asset(creator, previous.id)
    # 1) the asset, 2) the target status, 3) the status it is leaving
    mock_db.first.side_effect = [asset, target, previous]
    mock_db.all.return_value = [creator]  # the candidate users

    resp = client.put(f"/assets/{asset.id}/status", headers=auth_headers, json={"status_id": str(target.id)})

    assert resp.status_code == 200, resp.text
    assert resp.json()["status_id"] == str(target.id)
    assert asset.status_id == target.id

    added = [a for (a,), _ in mock_db.add.call_args_list]
    [log] = [a for a in added if isinstance(a, ActivityLog)]
    assert log.action.value == "status_changed"
    assert log.payload["from_status_name"] == "No Status"
    assert log.payload["to_status_name"] == "Needs PM Review"
    [note] = [a for a in added if isinstance(a, Notification)]
    assert note.user_id == creator.id
    assert note.type == NotificationType.status_change
    assert note.actor_id == test_user.id
    assert note.payload["status_name"] == "Needs PM Review"
    assert note.payload["status_color"] == "#3b82f6"

    kinds = [e[0] for e in events]
    assert kinds == ["commit", "email", "sse"]
    _, task_name, kw = events[1]
    assert task_name.endswith("send_status_change_email")
    assert kw["to_email"] == "c@t.local"
    assert kw["status_name"] == "Needs PM Review"
    assert kw["from_status_name"] == "No Status"
    assert kw["asset_link"].endswith(f"/projects/{asset.project_id}/assets/{asset.id}")
    assert events[2][1] == "asset_status_updated"
    assert events[2][2] == {"asset_id": str(asset.id), "status_id": str(target.id), "user_id": str(test_user.id)}


def test_in_app_preference_skips_the_email(client, auth_headers, mock_db, test_user, monkeypatch):
    events = _wire(monkeypatch)
    creator = _make_user(email="c@t.local", name="Creator")
    creator.preferences = {"notifications": {"status_updates": "in_app"}}
    target = _status()
    asset = _asset(creator, None)
    mock_db.first.side_effect = [asset, target]
    mock_db.all.return_value = [creator]

    resp = client.put(f"/assets/{asset.id}/status", headers=auth_headers, json={"status_id": str(target.id)})

    assert resp.status_code == 200, resp.text
    assert any(isinstance(a, Notification) for (a,), _ in mock_db.add.call_args_list)
    assert [e[0] for e in events] == ["sse"]


def test_legacy_enum_is_mirrored_only_for_a_status_that_names_it(client, auth_headers, mock_db, test_user, monkeypatch):
    _wire(monkeypatch)
    creator = _make_user(email="c@t.local", name="Creator")

    approved = _status(name="Approved", legacy_key="approved")
    asset = _asset(creator, None)
    mock_db.first.side_effect = [asset, approved]
    assert client.put(f"/assets/{asset.id}/status", headers=auth_headers, json={"status_id": str(approved.id)}).status_code == 200
    assert asset.status == AssetStatus.approved

    custom = _status(name="Client Review", legacy_key=None)
    asset2 = _asset(creator, None)
    asset2.status = AssetStatus.in_review
    mock_db.first.side_effect = [asset2, custom]
    assert client.put(f"/assets/{asset2.id}/status", headers=auth_headers, json={"status_id": str(custom.id)}).status_code == 200
    assert asset2.status == AssetStatus.in_review


def test_patch_asset_legacy_status_goes_through_the_same_service(client, auth_headers, mock_db, test_user, monkeypatch):
    monkeypatch.setattr(assets_module, "require_project_role", lambda db, pid, u, r: None)
    monkeypatch.setattr(assets_module, "_build_asset_response", _fake_response)
    calls = []
    monkeypatch.setattr(assets_module, "change_asset_status", lambda db, asset, target, user: calls.append((asset, target)))
    creator = _make_user(email="c@t.local", name="Creator")
    asset = _asset(creator, None)
    approved = _status(name="Approved", legacy_key="approved")
    # 1) the asset, 2) the status whose legacy_key is "approved"
    mock_db.first.side_effect = [asset, approved]

    resp = client.patch(f"/assets/{asset.id}", headers=auth_headers, json={"status": "approved", "rating": 4})

    assert resp.status_code == 200, resp.text
    assert calls == [(asset, approved)]
    assert asset.rating == 4
