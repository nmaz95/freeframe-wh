"""The pure half of services/status_notifications: who a status change tells.

No fixtures: these functions take plain values and return plain values, so a
rule's edge cases are a table, not a database.
"""
import uuid

from apps.api.services.status_notifications import (
    StatusRule, channels_for, merge_role_holders, resolve_status_recipients,
)

ACTOR, CREATOR, ASSIGNEE, PM, EDITOR = (uuid.uuid4() for _ in range(5))
ROLE_PM, ROLE_EDITOR, ROLE_HOS = (uuid.uuid4() for _ in range(3))


def _rule(creator=False, assignee=False, roles=()):
    return StatusRule(notify_creator=creator, notify_assignee=assignee, role_ids=frozenset(roles))


def _resolve(rule, *, holders=None, can_access=None, prefs=None, creator_id=CREATOR, assignee_id=ASSIGNEE):
    return resolve_status_recipients(
        rule,
        creator_id=creator_id,
        assignee_id=assignee_id,
        actor_id=ACTOR,
        role_holders=holders or {},
        can_access=can_access or (lambda uid: True),
        preferences=prefs or {},
    )


def _ids(recipients):
    return [r.user_id for r in recipients]


def test_empty_rule_tells_nobody():
    assert _resolve(_rule()) == []


def test_creator_is_told_with_reason():
    [r] = _resolve(_rule(creator=True))
    assert r.user_id == CREATOR
    assert r.reasons == ("creator",)
    assert (r.in_app, r.email) == (True, True)


def test_actor_is_never_told_even_as_creator():
    assert _resolve(_rule(creator=True), creator_id=ACTOR) == []


def test_actor_holding_a_role_is_still_excluded():
    assert _resolve(_rule(roles=[ROLE_PM]), holders={ROLE_PM: {ACTOR}}) == []


def test_creator_who_is_also_assignee_is_told_once_with_both_reasons():
    [r] = _resolve(_rule(creator=True, assignee=True), assignee_id=CREATOR)
    assert r.reasons == ("creator", "assignee")


def test_user_holding_two_roles_is_told_once():
    [r] = _resolve(_rule(roles=[ROLE_PM, ROLE_EDITOR]), holders={ROLE_PM: {PM}, ROLE_EDITOR: {PM}})
    assert r.user_id == PM
    assert set(r.reasons) == {f"role:{ROLE_PM}", f"role:{ROLE_EDITOR}"}


def test_role_in_rule_with_no_holders_is_fine():
    assert _resolve(_rule(roles=[ROLE_HOS]), holders={}) == []


def test_role_with_holders_but_not_in_rule_is_ignored():
    assert _resolve(_rule(roles=[ROLE_PM]), holders={ROLE_EDITOR: {EDITOR}}) == []


def test_missing_assignee_with_notify_assignee_adds_nobody():
    assert _resolve(_rule(assignee=True), assignee_id=None) == []


def test_user_without_access_is_dropped_entirely():
    out = _resolve(_rule(creator=True, roles=[ROLE_PM]), holders={ROLE_PM: {PM}}, can_access=lambda uid: uid != PM)
    assert _ids(out) == [CREATOR]


def test_preferences_pick_the_channels():
    assert channels_for(None) == (True, True)
    assert channels_for({}) == (True, True)
    assert channels_for({"notifications": "junk"}) == (True, True)
    assert channels_for({"notifications": {"status_updates": "whatever"}}) == (True, True)
    assert channels_for({"notifications": {"status_updates": "all_on"}}) == (True, True)
    assert channels_for({"notifications": {"status_updates": "in_app"}}) == (True, False)
    assert channels_for({"notifications": {"status_updates": "all_off"}}) == (False, False)


def test_all_off_recipient_is_absent_and_in_app_only_gets_no_email():
    prefs = {
        CREATOR: {"notifications": {"status_updates": "all_off"}},
        PM: {"notifications": {"status_updates": "in_app"}},
    }
    out = _resolve(_rule(creator=True, roles=[ROLE_PM]), holders={ROLE_PM: {PM}}, prefs=prefs)
    assert _ids(out) == [PM]
    assert (out[0].in_app, out[0].email) == (True, False)


def test_override_replaces_the_project_default_and_empty_override_falls_back():
    merged = merge_role_holders(
        [ROLE_PM, ROLE_EDITOR, ROLE_HOS],
        project_defaults={ROLE_PM: {PM}, ROLE_EDITOR: {EDITOR}},
        asset_overrides={ROLE_PM: {CREATOR}, ROLE_EDITOR: set(), ROLE_HOS: {ASSIGNEE}},
    )
    assert merged == {ROLE_PM: frozenset({CREATOR}), ROLE_EDITOR: frozenset({EDITOR}), ROLE_HOS: frozenset({ASSIGNEE})}


def test_order_is_stable_regardless_of_input_ordering():
    holders_a = {ROLE_PM: {PM, EDITOR}, ROLE_EDITOR: {ASSIGNEE}}
    holders_b = {ROLE_EDITOR: {ASSIGNEE}, ROLE_PM: {EDITOR, PM}}
    rule = _rule(creator=True, roles=[ROLE_EDITOR, ROLE_PM])
    assert _ids(_resolve(rule, holders=holders_a)) == _ids(_resolve(rule, holders=holders_b))
    assert _ids(_resolve(rule, holders=holders_a))[0] == CREATOR
