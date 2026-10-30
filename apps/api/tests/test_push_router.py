"""GET /me/push and the subscription endpoints, on the mocked session."""
import uuid
from unittest.mock import MagicMock

import pytest

import apps.api.routers.push as push
from apps.api.models.push import PushSubscription

PUB = "BPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
BODY = {
    "endpoint": "https://web.push.apple.com/QAbc123",
    "keys": {"p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", "auth": "tBHItJI5svbpez7KI4CCXg"},
}


@pytest.fixture
def disabled(monkeypatch):
    for name in ("vapid_public_key", "vapid_private_key", "vapid_subject"):
        monkeypatch.setattr(push.settings, name, "")


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(push.settings, "vapid_public_key", PUB)
    monkeypatch.setattr(push.settings, "vapid_private_key", "x" * 43)
    monkeypatch.setattr(push.settings, "vapid_subject", "mailto:admin@example.com")


def _row(user_id, endpoint=BODY["endpoint"]):
    row = MagicMock(spec=PushSubscription)
    row.id = uuid.uuid4()
    row.user_id = user_id
    row.endpoint = endpoint
    row.p256dh = "old"
    row.auth = "old"
    row.user_agent = "old UA"
    row.created_at = None
    row.last_used_at = None
    row.last_failed_at = None
    return row


def test_status_says_off_without_keys_and_touches_no_table(client, mock_db, auth_headers, disabled):
    r = client.get("/me/push", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == {"enabled": False, "public_key": None, "subscriptions": []}
    mock_db.query.assert_not_called()


def test_status_lists_this_users_devices_with_the_public_key(client, mock_db, auth_headers, test_user, enabled):
    mock_db.order_by.return_value = mock_db
    mock_db.all.return_value = [_row(test_user.id)]
    r = client.get("/me/push", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is True and body["public_key"] == PUB
    assert [s["endpoint"] for s in body["subscriptions"]] == [BODY["endpoint"]]
    assert "p256dh" not in body["subscriptions"][0]


def test_subscribe_is_refused_without_keys(client, mock_db, auth_headers, disabled):
    r = client.post("/me/push/subscriptions", json=BODY, headers=auth_headers)
    assert r.status_code == 503
    mock_db.add.assert_not_called()


def test_subscribe_creates_a_device_for_the_signed_in_user(client, mock_db, auth_headers, test_user, enabled):
    mock_db.first.return_value = None
    r = client.post("/me/push/subscriptions", json=BODY, headers={**auth_headers, "User-Agent": "FreeFrameTest/1.0"})
    assert r.status_code == 201, r.text
    [row] = [a for (a,), _ in mock_db.add.call_args_list if isinstance(a, PushSubscription)]
    assert row.user_id == test_user.id
    assert row.endpoint == BODY["endpoint"]
    assert (row.p256dh, row.auth) == (BODY["keys"]["p256dh"], BODY["keys"]["auth"])
    assert row.user_agent == "FreeFrameTest/1.0"
    mock_db.commit.assert_called_once()
    assert r.json()["endpoint"] == BODY["endpoint"]


def test_subscribing_the_same_browser_again_updates_its_row(client, mock_db, auth_headers, test_user, enabled):
    other = uuid.uuid4()
    existing = _row(other)
    existing.last_failed_at = "earlier"
    mock_db.first.return_value = existing
    r = client.post("/me/push/subscriptions", json=BODY, headers=auth_headers)
    assert r.status_code == 201
    mock_db.add.assert_not_called()
    assert existing.user_id == test_user.id  # whoever is signed in now owns the browser
    assert (existing.p256dh, existing.auth) == (BODY["keys"]["p256dh"], BODY["keys"]["auth"])
    assert existing.last_failed_at is None


@pytest.mark.parametrize("endpoint", ["ftp://push.example/x", "not a url", "http://push.example/x"])
def test_subscribe_wants_an_https_endpoint(client, mock_db, auth_headers, enabled, endpoint):
    r = client.post("/me/push/subscriptions", json={**BODY, "endpoint": endpoint}, headers=auth_headers)
    assert r.status_code == 422
    mock_db.add.assert_not_called()


def test_unsubscribe_deletes_only_this_users_row(client, mock_db, auth_headers, test_user):
    row = _row(test_user.id)
    mock_db.first.return_value = row
    r = client.delete(f"/me/push/subscriptions/{row.id}", headers=auth_headers)
    assert r.status_code == 204
    mock_db.delete.assert_called_once_with(row)
    mock_db.commit.assert_called_once()


def test_unsubscribe_unknown_is_404(client, mock_db, auth_headers):
    mock_db.first.return_value = None
    r = client.delete(f"/me/push/subscriptions/{uuid.uuid4()}", headers=auth_headers)
    assert r.status_code == 404
    mock_db.delete.assert_not_called()
