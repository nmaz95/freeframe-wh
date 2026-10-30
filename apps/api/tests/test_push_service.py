"""services/push_service: which preference a type answers to, what a push says
and where it goes (the web app's drawer, mirrored), and the dispatch hook."""
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import apps.api.services.push_service as svc
from apps.api.models.activity import NotificationType


def _note(type_, **kw):
    base = dict(id=uuid.uuid4(), user_id=uuid.uuid4(), asset_id=uuid.uuid4(), comment_id=None, actor_id=None, payload=None)
    base.update(kw)
    return SimpleNamespace(type=type_, **base)


def test_the_preference_a_type_answers_to():
    assert svc.preference_key(_note(NotificationType.status_change), None) == "status_updates"
    assert svc.preference_key(_note(NotificationType.mention), None) == "mentions"
    assert svc.preference_key(_note(NotificationType.assignment), None) == "assigned_to_you"
    top = SimpleNamespace(parent_id=None)
    reply = SimpleNamespace(parent_id=uuid.uuid4())
    assert svc.preference_key(_note(NotificationType.comment), top) == "general_comments"
    assert svc.preference_key(_note(NotificationType.comment), reply) == "comment_replies"
    for always in (NotificationType.approval, NotificationType.delivery, NotificationType.due_soon):
        assert svc.preference_key(_note(always), None) is None


def test_only_all_off_silences_a_push():
    assert svc.push_allowed({"notifications": {"mentions": "all_off"}}, "mentions") is False
    assert svc.push_allowed({"notifications": {"mentions": "in_app"}}, "mentions") is True
    assert svc.push_allowed({"notifications": {"mentions": "all_on"}}, "mentions") is True
    assert svc.push_allowed({}, "mentions") is True
    assert svc.push_allowed(None, "mentions") is True
    assert svc.push_allowed({"notifications": "junk"}, "mentions") is True
    assert svc.push_allowed({"notifications": {"mentions": "all_off"}}, None) is True


def test_where_a_tap_goes(monkeypatch):
    monkeypatch.setattr(svc.settings, "frontend_url", "https://ff.example")
    asset = SimpleNamespace(id=uuid.uuid4(), project_id=uuid.uuid4(), name="Spot")
    cid = uuid.uuid4()
    assert svc.notification_url(_note(NotificationType.comment, comment_id=cid), asset) == f"https://ff.example/projects/{asset.project_id}/assets/{asset.id}?commentId={cid}"
    assert svc.notification_url(_note(NotificationType.approval), asset) == f"https://ff.example/projects/{asset.project_id}/assets/{asset.id}"
    bulk = _note(NotificationType.status_change, payload={"asset_count": 3, "project_id": "p1", "status_id": "s1", "status_name": "Approved"})
    assert svc.notification_url(bulk, asset) == "https://ff.example/projects/p1?status=s1"
    done = _note(NotificationType.delivery, payload={"status": "done", "web_view_link": "https://drive.google.com/file/d/x/view"})
    assert svc.notification_url(done, asset) == "https://drive.google.com/file/d/x/view"
    failed = _note(NotificationType.delivery, payload={"status": "failed", "web_view_link": None})
    assert svc.notification_url(failed, asset).endswith(f"/assets/{asset.id}")
    assert svc.notification_url(_note(NotificationType.comment), None) is None


def test_the_words_match_the_drawer():
    t = svc.notification_text
    assert t(_note(NotificationType.mention), "Spot", "Paola PM", "Il logo entra") == ("Paola PM mentioned you on Spot", "Il logo entra")
    assert t(_note(NotificationType.comment), None, "Someone", None) == ("Someone commented on an asset", "")
    assert t(_note(NotificationType.assignment), "Spot", "Marco", None) == ("Marco assigned you to Spot", "")
    assert t(_note(NotificationType.due_soon), "Spot", "Someone", None) == ("Spot is due soon", "")
    single = _note(NotificationType.status_change, payload={"status_name": "Approved", "from_status_name": "Needs PM Review"})
    assert t(single, "Spot", "Paola PM", None) == ("Paola PM moved Spot to Approved", "was Needs PM Review")
    bulk = _note(NotificationType.status_change, payload={"status_name": "Approved", "asset_count": 7, "asset_names": ["A", "B"]})
    assert t(bulk, "Spot", "Paola PM", None) == ("Paola PM moved 7 assets to Approved", "A, B, and 5 more")
    done = _note(NotificationType.delivery, payload={"status": "done", "folder_name": "Consegne / Barilla", "file_name": "Spot v1.mp4"})
    assert t(done, "Spot", "Me", None) == ("Spot delivered to Consegne / Barilla", "Spot v1.mp4")
    failed = _note(NotificationType.delivery, payload={"status": "failed", "error": "Google account disconnected"})
    assert t(failed, "Spot", "Me", None) == ("Delivery of Spot failed", "Google account disconnected")


def test_payload_names_the_comment_author_and_focuses_the_comment(monkeypatch):
    monkeypatch.setattr(svc.settings, "frontend_url", "https://ff.example")
    asset = SimpleNamespace(id=uuid.uuid4(), project_id=uuid.uuid4(), name="Spot 30s", deleted_at=None)
    author = SimpleNamespace(id=uuid.uuid4(), name="Paola PM")
    comment = SimpleNamespace(id=uuid.uuid4(), author_id=author.id, guest_author_id=None, parent_id=None, body="x" * 150)
    note = _note(NotificationType.comment, comment_id=comment.id)
    db = MagicMock()
    db.query.return_value.filter.return_value.first.side_effect = [asset, comment, author]
    payload = svc.build_push_payload(db, note)
    assert payload["title"] == "Paola PM commented on Spot 30s"
    assert payload["body"] == "x" * 100
    assert payload["url"] == f"https://ff.example/projects/{asset.project_id}/assets/{asset.id}?commentId={comment.id}"
    assert payload["tag"] == str(note.id) and payload["type"] == "comment"


def test_payload_is_none_once_the_asset_is_trashed():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    assert svc.build_push_payload(db, _note(NotificationType.comment)) is None


def test_notify_push_queues_one_task_per_row_only_when_enabled(monkeypatch):
    sent = []
    monkeypatch.setattr(svc, "send_task_safe", lambda task, *a, **kw: sent.append((task.name, a)))
    rows = [_note(NotificationType.comment), None, _note(NotificationType.mention), _note(NotificationType.comment, id=None)]
    for name in ("vapid_public_key", "vapid_private_key", "vapid_subject"):
        monkeypatch.setattr(svc.settings, name, "")
    svc.notify_push(MagicMock(), rows)
    assert sent == []
    monkeypatch.setattr(svc.settings, "vapid_public_key", "pk")
    monkeypatch.setattr(svc.settings, "vapid_private_key", "sk")
    monkeypatch.setattr(svc.settings, "vapid_subject", "mailto:a@b.c")
    svc.notify_push(MagicMock(), rows)
    assert [a for _, a in sent] == [(str(rows[0].id),), (str(rows[2].id),)]
    assert all(name.endswith("push_tasks.send_push_notification") for name, _ in sent)
