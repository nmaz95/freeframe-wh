"""Moving several assets at once: PUT /assets/status, one commit, and each
person the status names told once."""
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

from fastapi import HTTPException

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


def _asset(creator, status_id, project_id, name="Spot"):
    a = MagicMock()
    a.id = uuid.uuid4()
    a.project_id = project_id
    a.name = name
    a.created_by = creator.id
    a.assignee_id = None
    a.status_id = status_id
    a.status = AssetStatus.draft
    a.deleted_at = None
    return a


def _fake_responses(assets, db):
    return [
        AssetResponse(
            id=a.id, project_id=a.project_id, name=a.name, description=None,
            asset_type="video", status="draft", status_id=a.status_id, rating=None,
            assignee_id=None, due_date=None, keywords=[], created_by=a.created_by,
            created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        )
        for a in assets
    ]


def _wire(monkeypatch, *, role_ok=True, role_ids=frozenset(), holders=None):
    """Bypass what the mock DB cannot answer, and record the side effects."""
    events = []
    if role_ok:
        monkeypatch.setattr(statuses_module, "require_project_role", lambda db, pid, u, r: events.append(("role", pid)))
    else:
        def refuse(db, pid, u, r):
            raise HTTPException(status_code=403, detail="Requires reviewer role or higher")
        monkeypatch.setattr(statuses_module, "require_project_role", refuse)
    monkeypatch.setattr(statuses_module, "_build_asset_responses_bulk", _fake_responses)
    monkeypatch.setattr(svc, "notify_role_ids", lambda db, sid: role_ids)
    monkeypatch.setattr(svc, "load_role_holders", lambda db, asset, ids: dict(holders or {}))
    monkeypatch.setattr(svc, "can_access_asset", lambda db, asset, user: True)
    monkeypatch.setattr(svc, "send_task_safe", lambda task, **kw: events.append(("email", task.name, kw)))
    monkeypatch.setattr(svc.event_service, "publish_sync", lambda pid, et, payload: events.append(("sse", et, payload)) or True)
    return events


def _added(mock_db, kind):
    return [c.args[0] for c in mock_db.add.call_args_list if isinstance(c.args[0], kind)]


def _put(client, auth_headers, assets, target):
    return client.put(
        "/assets/status", headers=auth_headers,
        json={"asset_ids": [str(a.id) for a in assets], "status_id": str(target.id)},
    )


def test_requires_reviewer_role(client, auth_headers, mock_db, monkeypatch):
    events = _wire(monkeypatch, role_ok=False)
    creator = _make_user(email="c@t.local", name="Creator")
    pid = uuid.uuid4()
    assets = [_asset(creator, uuid.uuid4(), pid), _asset(creator, uuid.uuid4(), pid)]
    mock_db.all.side_effect = [assets]

    resp = _put(client, auth_headers, assets, _status())

    assert resp.status_code == 403
    mock_db.add.assert_not_called()
    mock_db.commit.assert_not_called()
    assert events == []


def test_assets_of_two_projects_are_refused(client, auth_headers, mock_db, monkeypatch):
    events = _wire(monkeypatch)
    creator = _make_user(email="c@t.local", name="Creator")
    assets = [_asset(creator, None, uuid.uuid4()), _asset(creator, None, uuid.uuid4())]
    mock_db.all.side_effect = [assets]

    resp = _put(client, auth_headers, assets, _status())

    assert resp.status_code == 400
    mock_db.commit.assert_not_called()
    assert events == []


def test_an_unknown_asset_refuses_the_whole_call(client, auth_headers, mock_db, monkeypatch):
    events = _wire(monkeypatch)
    creator = _make_user(email="c@t.local", name="Creator")
    pid = uuid.uuid4()
    assets = [_asset(creator, None, pid), _asset(creator, None, pid)]
    mock_db.all.side_effect = [assets[:1]]  # one of the two ids is gone

    resp = _put(client, auth_headers, assets, _status())

    assert resp.status_code == 404
    mock_db.commit.assert_not_called()
    assert events == []


def test_each_person_hears_once_for_all_their_assets(client, auth_headers, mock_db, test_user, monkeypatch):
    role = uuid.uuid4()
    creator = _make_user(email="c@t.local", name="Creator")
    pm = _make_user(email="pm@t.local", name="Paola")
    creator.preferences = {}
    pm.preferences = {}
    events = _wire(monkeypatch, role_ids=frozenset({role}), holders={role: frozenset({pm.id})})
    mock_db.commit.side_effect = lambda: events.append(("commit",))
    pid = uuid.uuid4()
    previous = _status(name="No Status")
    target = _status(name="Needs PM Review", color="#3b82f6")
    assets = [_asset(creator, previous.id, pid, name=f"Clip {i}") for i in range(3)]
    # .all(): the assets, the previous statuses, the candidate users, the members
    mock_db.all.side_effect = [assets, [previous], [creator, pm], [(creator.id,), (pm.id,)]]
    mock_db.first.side_effect = [target]

    resp = _put(client, auth_headers, assets, target)

    assert resp.status_code == 200, resp.text
    assert [r["id"] for r in resp.json()] == [str(a.id) for a in assets]
    assert all(a.status_id == target.id for a in assets)
    assert len(_added(mock_db, ActivityLog)) == 3

    notes = _added(mock_db, Notification)
    assert {n.user_id for n in notes} == {creator.id, pm.id}
    for n in notes:
        assert n.type == NotificationType.status_change
        assert n.actor_id == test_user.id
        assert n.asset_id == assets[0].id
        assert n.payload["asset_count"] == 3
        assert n.payload["asset_ids"] == [str(a.id) for a in assets]
        assert n.payload["asset_names"] == ["Clip 0", "Clip 1", "Clip 2"]
        assert n.payload["status_name"] == "Needs PM Review"
        assert n.payload["project_id"] == str(pid)

    kinds = [e[0] for e in events]
    assert kinds == ["role", "commit", "email", "email", "sse", "sse", "sse"]
    emails = [e for e in events if e[0] == "email"]
    assert {e[1] for e in emails} == {"apps.api.tasks.email_tasks.send_bulk_status_change_email"}
    assert {e[2]["to_email"] for e in emails} == {"c@t.local", "pm@t.local"}
    assert all(e[2]["asset_count"] == 3 and e[2]["project_link"].endswith(f"/projects/{pid}?status={target.id}") for e in emails)
    assert [e[2]["asset_id"] for e in events if e[0] == "sse"] == [str(a.id) for a in assets]


def test_someone_concerned_with_one_asset_gets_the_single_message(client, auth_headers, mock_db, monkeypatch):
    creator_a = _make_user(email="a@t.local", name="Anna")
    creator_b = _make_user(email="b@t.local", name="Bruno")
    creator_a.preferences = {}
    creator_b.preferences = {}
    events = _wire(monkeypatch)
    pid = uuid.uuid4()
    previous = _status(name="No Status")
    target = _status(name="Approved", legacy_key="approved")
    a = _asset(creator_a, previous.id, pid, name="A")
    b1 = _asset(creator_b, None, pid, name="B1")
    b2 = _asset(creator_b, None, pid, name="B2")
    assets = [a, b1, b2]
    mock_db.all.side_effect = [assets, [previous], [creator_a, creator_b], [(creator_a.id,), (creator_b.id,)]]
    mock_db.first.side_effect = [target]

    resp = _put(client, auth_headers, assets, target)

    assert resp.status_code == 200, resp.text
    assert all(x.status == AssetStatus.approved for x in assets)  # legacy mirror on each
    notes = {n.user_id: n for n in _added(mock_db, Notification)}
    assert "asset_count" not in notes[creator_a.id].payload
    assert notes[creator_a.id].asset_id == a.id
    assert notes[creator_a.id].payload["from_status_name"] == "No Status"
    assert notes[creator_b.id].payload["asset_count"] == 2
    assert notes[creator_b.id].payload["from_status_name"] is None
    emails = {e[2]["to_email"]: e[1] for e in events if e[0] == "email"}
    assert emails == {
        "a@t.local": "apps.api.tasks.email_tasks.send_status_change_email",
        "b@t.local": "apps.api.tasks.email_tasks.send_bulk_status_change_email",
    }


def test_assets_already_there_are_left_alone(client, auth_headers, mock_db, monkeypatch):
    creator = _make_user(email="c@t.local", name="Creator")
    creator.preferences = {}
    events = _wire(monkeypatch)
    pid = uuid.uuid4()
    target = _status(name="Approved")
    moving = _asset(creator, None, pid, name="Moves")
    staying = _asset(creator, target.id, pid, name="Stays")
    assets = [moving, staying]
    mock_db.all.side_effect = [assets, [creator], [(creator.id,)]]  # no previous statuses: none had one
    mock_db.first.side_effect = [target]

    resp = _put(client, auth_headers, assets, target)

    assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 2
    assert len(_added(mock_db, ActivityLog)) == 1
    notes = _added(mock_db, Notification)
    assert len(notes) == 1 and notes[0].asset_id == moving.id and "asset_count" not in notes[0].payload
    assert [e[2]["asset_id"] for e in events if e[0] == "sse"] == [str(moving.id)]


def test_nothing_moves_nothing_is_written(client, auth_headers, mock_db, monkeypatch):
    creator = _make_user(email="c@t.local", name="Creator")
    events = _wire(monkeypatch)
    pid = uuid.uuid4()
    target = _status(name="Approved")
    assets = [_asset(creator, target.id, pid), _asset(creator, target.id, pid)]
    mock_db.all.side_effect = [assets]
    mock_db.first.side_effect = [target]

    resp = _put(client, auth_headers, assets, target)

    assert resp.status_code == 200, resp.text
    mock_db.add.assert_not_called()
    mock_db.commit.assert_not_called()
    assert [e for e in events if e[0] != "role"] == []


def test_preferences_and_the_actor_are_honoured(client, auth_headers, mock_db, test_user, monkeypatch):
    quiet = _make_user(email="q@t.local", name="Quiet")
    quiet.preferences = {"notifications": {"status_updates": "in_app"}}
    off = _make_user(email="o@t.local", name="Off")
    off.preferences = {"notifications": {"status_updates": "all_off"}}
    events = _wire(monkeypatch)
    pid = uuid.uuid4()
    target = _status(name="Approved")
    mine = _asset(test_user, None, pid, name="Mine")       # the actor's own: nobody told
    theirs = _asset(quiet, None, pid, name="Quiet's")
    offs = _asset(off, None, pid, name="Off's")
    assets = [mine, theirs, offs]
    mock_db.all.side_effect = [assets, [quiet, off], [(quiet.id,), (off.id,)]]
    mock_db.first.side_effect = [target]

    resp = _put(client, auth_headers, assets, target)

    assert resp.status_code == 200, resp.text
    notes = _added(mock_db, Notification)
    assert [n.user_id for n in notes] == [quiet.id]
    assert [e for e in events if e[0] == "email"] == []
    assert len([e for e in events if e[0] == "sse"]) == 3


def test_duplicate_ids_count_once(client, auth_headers, mock_db, monkeypatch):
    creator = _make_user(email="c@t.local", name="Creator")
    creator.preferences = {}
    events = _wire(monkeypatch)
    pid = uuid.uuid4()
    target = _status(name="Approved")
    a = _asset(creator, None, pid)
    mock_db.all.side_effect = [[a], [creator], [(creator.id,)]]
    mock_db.first.side_effect = [target]

    resp = client.put("/assets/status", headers=auth_headers,
                      json={"asset_ids": [str(a.id), str(a.id)], "status_id": str(target.id)})

    assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 1
    assert len(_added(mock_db, ActivityLog)) == 1
