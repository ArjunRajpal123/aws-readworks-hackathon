"""Offline tests for common/rbac.py using the demo cast in a FakeTable."""
import pytest

from common import people_store as ps
from common import rbac
from fake_dynamodb import FakeTable
from test_people_store import seed_people


@pytest.fixture
def store():
    s = ps.PeopleStore(FakeTable())
    seed_people.seed(s, log=lambda *_: None)
    return s


def event(sub, groups, email="x@school.org"):
    return {"requestContext": {"authorizer": {"jwt": {"claims": {
        "sub": sub, "email": email, "cognito:groups": groups}}}}}


@pytest.mark.parametrize("raw,expected", [
    ("[admin teacher]", ["admin", "teacher"]),
    ("admin", ["admin"]),
    ("[student]", ["student"]),
    ("admin,teacher", ["admin", "teacher"]),
    ("[admin, teacher]", ["admin", "teacher"]),
    ('["parent","student"]', ["parent", "student"]),
    (["teacher", "parent"], ["teacher", "parent"]),
    ("[]", []),
    ("", []),
    (None, []),
    (42, []),
    (["admin", "admin", 5], ["admin"]),
])
def test_parse_groups_formats(raw, expected):
    assert rbac.parse_groups({"cognito:groups": raw}) == expected


def test_parse_groups_missing_claim():
    assert rbac.parse_groups({}) == []
    assert rbac.parse_groups(None) == []
    assert rbac.claims_from_event({}) == {}


@pytest.mark.parametrize("groups,role", [
    (["student", "admin"], "admin"),
    (["parent", "teacher"], "teacher"),
    (["student", "parent"], "parent"),
    (["student"], "student"),
    (["staff"], None),
    ([], None),
])
def test_primary_role(groups, role):
    assert rbac.primary_role(groups) == role


def test_resolve_caller_requires_known_sub_and_matching_group(store):
    store.attach_cognito_sub("t-rivera", "sub-rivera")
    assert rbac.resolve_caller(event("sub-rivera", "[teacher]"), store)["id"] == "t-rivera"
    assert rbac.resolve_caller(event("sub-rivera", "teacher"), store)["id"] == "t-rivera"
    # token lacks the teacher group: deny even though the record exists
    assert rbac.resolve_caller(event("sub-rivera", "[student]"), store) is None
    # an admin group on the token does not upgrade a teacher record
    assert rbac.resolve_caller(event("sub-rivera", "[admin teacher]"), store)["role"] == "teacher"
    assert rbac.resolve_caller(event("unknown", "[admin]"), store) is None
    assert rbac.resolve_caller(event("", "[admin]"), store) is None
    assert rbac.resolve_caller({"sub": "sub-rivera", "cognito:groups": ["teacher"]}, store)["id"] == "t-rivera"
    assert rbac.resolve_caller({}, store) is None


def test_can_view_student(store):
    admin = store.get_person("a-admin")
    rivera = store.get_person("t-rivera")
    okafor = store.get_person("t-okafor")
    chen = store.get_person("p-chen")
    maya = store.get_person("s-maya")
    assert rbac.can_view_student(admin, "s-mason", store)
    assert rbac.can_view_student(rivera, "s-maya", store)          # in Room 4
    assert not rbac.can_view_student(rivera, "s-sofia", store)     # Room 12
    assert rbac.can_view_student(okafor, "s-sofia", store)
    assert rbac.can_view_student(chen, "s-maya", store)
    assert rbac.can_view_student(chen, "s-daniel", store)
    assert not rbac.can_view_student(chen, "s-noah", store)
    assert rbac.can_view_student(maya, "s-maya", store)
    assert not rbac.can_view_student(maya, "s-noah", store)
    # malformed / missing input is a denial, not an exception
    assert not rbac.can_view_student(rivera, "bad#id", store)
    assert not rbac.can_view_student(None, "s-maya", store)
    assert not rbac.can_view_student({"id": "x", "role": "root"}, "s-maya", store)
    assert not rbac.can_view_student(admin, "", store)


def test_teacher_access_follows_enrolment(store):
    rivera = store.get_person("t-rivera")
    assert not rbac.can_view_student(rivera, "s-sofia", store)
    store.enrol_student("s-sofia", "c2")
    assert rbac.can_view_student(rivera, "s-sofia", store)
    store.unenrol_student("s-sofia", "c2")
    assert not rbac.can_view_student(rivera, "s-sofia", store)


def test_can_view_class(store):
    rivera = store.get_person("t-rivera")
    assert rbac.can_view_class(store.get_person("a-admin"), "c10", store)
    assert rbac.can_view_class(rivera, "c2", store)
    assert not rbac.can_view_class(rivera, "c4", store)
    assert not rbac.can_view_class(store.get_person("p-chen"), "c2", store)
    assert not rbac.can_view_class(store.get_person("s-maya"), "c2", store)


def test_can_assign(store):
    admin = store.get_person("a-admin")
    rivera = store.get_person("t-rivera")
    chen = store.get_person("p-chen")
    maya = store.get_person("s-maya")
    assert rbac.can_assign(admin, store, class_id="c7")
    assert rbac.can_assign(admin, store, student_id="s-mason")
    assert rbac.can_assign(rivera, store, class_id="c2")
    assert rbac.can_assign(rivera, store, student_id="s-noah")
    assert not rbac.can_assign(rivera, store, class_id="c4")
    assert not rbac.can_assign(rivera, store, student_id="s-sofia")
    assert rbac.can_assign(chen, store, student_id="s-daniel")
    assert not rbac.can_assign(chen, store, student_id="s-noah")
    assert not rbac.can_assign(chen, store, class_id="c2")         # parents can't assign classes
    assert not rbac.can_assign(maya, store, student_id="s-maya")
    assert not rbac.can_assign(admin, store)                       # no target
    assert not rbac.can_assign(admin, store, student_id="s-maya", class_id="c2")


def test_can_append_session_and_manage(store):
    maya = store.get_person("s-maya")
    assert rbac.can_append_session(maya, "s-maya")
    assert not rbac.can_append_session(maya, "s-noah")
    assert not rbac.can_append_session(store.get_person("p-chen"), "s-maya")
    assert not rbac.can_append_session(store.get_person("t-rivera"), "s-maya")
    assert rbac.can_append_session(store.get_person("a-admin"), "s-maya")
    assert rbac.can_manage_people(store.get_person("a-admin"))
    assert not rbac.can_manage_people(store.get_person("t-rivera"))


def test_end_to_end_parent_sends_reading(store):
    store.attach_cognito_sub("p-chen", "sub-chen")
    caller = rbac.resolve_caller(event("sub-chen", "parent"), store)
    assert rbac.can_assign(caller, store, student_id="s-maya")
    store.put_assignment("k2", caller, student_id="s-maya", assignment_id="a1",
                         due="2026-04-01T00:00:00Z")
    store.attach_cognito_sub("s-maya", "sub-maya")
    me = rbac.resolve_caller(event("sub-maya", "[student]"), store)
    assert [a["byName"] for a in store.up_next(me["id"])] == ["Priya Chen"]
