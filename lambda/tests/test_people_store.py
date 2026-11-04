"""Offline tests for common/people_store.py against the in-memory FakeTable."""
import importlib.util
import json
import re
from decimal import Decimal
from pathlib import Path

import pytest

from common import people_store as ps
from fake_dynamodb import FakeTable

REPO = Path(__file__).resolve().parents[2]
NOW = "2026-03-01T12:00:00.000Z"


def _load_seed_module():
    spec = importlib.util.spec_from_file_location(
        "seed_people", REPO / "lambda" / "scripts" / "seed_people.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


seed_people = _load_seed_module()


@pytest.fixture
def table():
    return FakeTable()


@pytest.fixture
def store(table):
    return ps.PeopleStore(table)


@pytest.fixture
def demo(store):
    seed_people.seed(store, log=lambda *_: None)
    return store


# -- people -------------------------------------------------------------------

def test_put_person_never_overwrites(store):
    store.put_person("t-x", "teacher", "Ms. X", email="X@school.org")
    with pytest.raises(ps.AlreadyExists):
        store.put_person("t-x", "teacher", "Someone Else")
    p = store.get_person("t-x")
    assert p["name"] == "Ms. X" and p["email"] == "x@school.org" and p["sub"] == ""


def test_person_validation(store):
    with pytest.raises(ValueError):
        store.put_person("s-a", "student", "Kid", email="kid@x.org")  # no student email
    with pytest.raises(ValueError):
        store.put_person("bad#id", "teacher", "X")
    with pytest.raises(ValueError):
        store.put_person("t-y", "superuser", "X")
    with pytest.raises(ValueError):
        store.put_person("t-y", "teacher", "  ")


def test_update_person_keeps_role_sub_and_created(store):
    store.put_person("p-a", "parent", "Pat", now=NOW)
    store.attach_cognito_sub("p-a", "sub-1")
    u = store.update_person("p-a", name="Pat Smith", email="pat@x.org")
    assert u["role"] == "parent" and u["sub"] == "sub-1" and u["createdAt"] == NOW
    assert store.get_person("p-a")["name"] == "Pat Smith"
    assert store.get_person("p-a")["gsi1sk"] == "pat smith#p-a"
    with pytest.raises(ps.NotFound):
        store.update_person("p-nobody", name="X")


def test_list_people_by_role_sorted_and_paginated(demo):
    page = demo.list_people_by_role("teacher")
    assert [p["name"] for p in page["items"]] == ["Mr. Bennett", "Mr. Okafor", "Ms. Alvarez", "Ms. Rivera"]
    assert page["next"] is None
    first = demo.list_people_by_role("student", limit=10)
    assert len(first["items"]) == 10 and first["next"]
    rest, nxt = [], first["next"]
    while nxt:
        page = demo.list_people_by_role("student", limit=10, start_key=nxt)
        rest.extend(page["items"])
        nxt = page["next"]
    ids = [p["id"] for p in first["items"] + rest]
    assert len(ids) == 24 == len(set(ids))
    assert {p["role"] for p in demo.list_people_by_role("admin")["items"]} == {"admin"}


# -- Cognito sub ----------------------------------------------------------------

def test_attach_sub_and_lookup(demo):
    assert demo.get_person_by_sub("sub-rivera") is None
    demo.attach_cognito_sub("t-rivera", "sub-rivera")
    me = demo.get_person_by_sub("sub-rivera")
    assert me["id"] == "t-rivera" and me["role"] == "teacher"
    # idempotent
    demo.attach_cognito_sub("t-rivera", "sub-rivera")
    assert demo.get_person_by_sub("sub-rivera")["id"] == "t-rivera"


def test_sub_is_unique_and_person_has_one_sub(demo):
    demo.attach_cognito_sub("t-rivera", "sub-1")
    with pytest.raises(ps.Conflict):
        demo.attach_cognito_sub("t-okafor", "sub-1")   # sub already used
    with pytest.raises(ps.Conflict):
        demo.attach_cognito_sub("t-rivera", "sub-2")   # person already linked
    assert demo.get_person_by_sub("sub-2") is None
    assert demo.get_person("t-okafor")["sub"] == ""


def test_attach_rolls_back_pointer_when_person_write_races(demo, table):
    original = table.put_item

    def racing_put(Item, ConditionExpression=None, **kw):
        if Item.get("sk") == "PROFILE" and Item.get("id") == "t-okafor":
            # someone else attached first
            stored = table.items[("PERSON#t-okafor", "PROFILE")]
            stored["sub"] = "other-sub"
        return original(Item=Item, ConditionExpression=ConditionExpression, **kw)

    table.put_item = racing_put
    with pytest.raises(ps.Conflict):
        demo.attach_cognito_sub("t-okafor", "sub-new")
    assert ("SUB#sub-new", "SUB") not in table.items


def test_detach_sub(demo):
    demo.attach_cognito_sub("p-chen", "sub-chen")
    demo.detach_cognito_sub("p-chen")
    assert demo.get_person_by_sub("sub-chen") is None
    assert demo.get_person("p-chen")["sub"] == ""
    demo.attach_cognito_sub("p-chen", "sub-chen-2")
    assert demo.get_person_by_sub("sub-chen-2")["id"] == "p-chen"


def test_stale_pointer_is_ignored(demo, table):
    table.put_item(Item={"pk": "SUB#ghost", "sk": "SUB", "type": "sub", "personId": "s-maya"})
    assert demo.get_person_by_sub("ghost") is None
    assert demo.get_person_by_sub("not a valid sub!") is None


# -- relationships ---------------------------------------------------------------

def test_teacher_classes_and_class_students(demo):
    assert [c["classId"] for c in demo.list_teacher_classes("t-rivera")] == ["c2"]
    studs = demo.list_class_students("c2")
    assert [s["studentId"] for s in studs] == sorted(
        ["s-maya", "s-noah", "s-ava", "s-leo", "s-zoe", "s-eli"])
    assert all(s["studentName"] for s in studs)
    assert [t["teacherId"] for t in demo.list_class_teachers("c2")] == ["t-rivera"]
    assert [c["id"] for c in demo.list_classes()] == ["c2", "c4", "c7", "c10"]


def test_parent_children_both_directions(demo):
    assert [k["studentId"] for k in demo.list_children("p-chen")] == ["s-daniel", "s-maya"]
    assert [p["parentId"] for p in demo.list_parents("s-maya")] == ["p-chen"]
    assert demo.is_parent_of("p-chen", "s-maya")
    assert not demo.is_parent_of("p-chen", "s-noah")


def test_links_are_idempotent_and_role_checked(demo):
    assert demo.link_parent_student("p-chen", "s-maya") is False
    assert demo.enrol_student("s-maya", "c2") is False
    assert demo.link_teacher_class("t-rivera", "c2") is False
    assert demo.link_parent_student("p-brooks", "s-maya") is True
    with pytest.raises(ValueError):
        demo.link_parent_student("t-rivera", "s-maya")      # not a parent
    with pytest.raises(ValueError):
        demo.enrol_student("p-chen", "c2")                   # not a student
    with pytest.raises(ps.NotFound):
        demo.link_teacher_class("t-rivera", "c99")


def test_student_in_two_classes_and_unlink(demo):
    demo.enrol_student("s-maya", "c4")
    assert sorted(c["classId"] for c in demo.list_student_classes("s-maya")) == ["c2", "c4"]
    demo.unenrol_student("s-maya", "c4")
    assert [c["classId"] for c in demo.list_student_classes("s-maya")] == ["c2"]
    demo.unlink_parent_student("p-chen", "s-maya")
    assert not demo.is_parent_of("p-chen", "s-maya")
    demo.unlink_teacher_class("t-rivera", "c2")
    assert demo.list_teacher_classes("t-rivera") == []


# -- assignments and sessions ----------------------------------------------------

def test_assignments_direct_and_class_sorted_by_due(demo):
    rivera = demo.get_person("t-rivera")
    chen = demo.get_person("p-chen")
    demo.put_assignment("k2", rivera, class_id="c2", due="2026-03-10T00:00:00Z",
                        assignment_id="a1", now=NOW)
    demo.put_assignment("g-k1q1-en", chen, student_id="s-maya", due="2026-03-05T00:00:00+00:00",
                        assignment_id="a2", now=NOW)
    mine = demo.list_assignments_for_student("s-maya")
    assert [a["id"] for a in mine] == ["a2", "a1"]
    assert mine[0]["due"] == "2026-03-05T00:00:00.000Z"   # normalised
    assert mine[1]["to"] == "c:c2" and mine[1]["toType"] == "class"
    assert [a["id"] for a in demo.list_assignments_for_student("s-noah")] == ["a1"]
    assert [a["id"] for a in demo.list_assignments_by("p-chen")] == ["a2"]
    # retry with the same id is a no-op
    again = demo.put_assignment("k2", rivera, class_id="c2", due="2026-03-10T00:00:00Z",
                                assignment_id="a1", now=NOW)
    assert again["id"] == "a1" and len(demo.list_assignments_for_class("c2")) == 1
    demo.delete_assignment(mine[0])
    assert [a["id"] for a in demo.list_assignments_for_student("s-maya")] == ["a1"]
    with pytest.raises(ValueError):
        demo.put_assignment("k2", rivera)
    with pytest.raises(ValueError):
        demo.put_assignment("k2", rivera, student_id="s-maya", class_id="c2")


def test_sessions_append_list_and_up_next(demo):
    rivera = demo.get_person("t-rivera")
    demo.put_assignment("k2", rivera, class_id="c2", due="2026-03-10T00:00:00Z",
                        assignment_id="a1", now=NOW)
    demo.put_assignment("e1", rivera, student_id="s-maya", due="2026-03-11T00:00:00Z",
                        assignment_id="a2", now=NOW)
    # read before it was assigned: does not count
    demo.append_session("s-maya", "k2", 3.5, words=["habitat"], at="2026-02-01T09:00:00Z", session_id="r1")
    assert [a["id"] for a in demo.up_next("s-maya")] == ["a1", "a2"]
    s = demo.append_session("s-maya", "k2", 4.25, words=["habitat", "burrow"], q=90, source="assigned",
                            stars=3, at="2026-03-02T09:00:00Z", session_id="r2")
    assert s["minutes"] == 4.25 and isinstance(s["minutes"], float)
    assert [a["id"] for a in demo.up_next("s-maya")] == ["a2"]
    sessions = demo.list_sessions_for_student("s-maya")
    assert [x["id"] for x in sessions] == ["r2", "r1"]               # newest first
    assert demo.list_sessions_for_student("s-maya", limit=1)[0]["id"] == "r2"
    # duplicate append is a no-op
    demo.append_session("s-maya", "k2", 4.25, at="2026-03-02T09:00:00Z", session_id="r2")
    assert len(demo.list_sessions_for_student("s-maya")) == 2
    # sessions live with the student, not in other students' partitions
    assert demo.list_sessions_for_student("s-noah") == []


def test_session_validation(demo):
    for bad in (dict(minutes=-1), dict(minutes=True), dict(q=101), dict(stars=4),
                dict(source="hack"), dict(at="yesterday")):
        kwargs = dict(minutes=1)
        kwargs.update(bad)
        with pytest.raises(ValueError):
            demo.append_session("s-maya", "k2", **kwargs)


def test_word_practice_counts(demo, table):
    demo.record_word_practice("s-maya", "Habitat", True, now=NOW)
    demo.record_word_practice("s-maya", "habitat", True, now=NOW)
    w = demo.record_word_practice("s-maya", "habitat", False, now=NOW)
    assert (w["k"], w["m"], w["w"]) == (2, 1, "habitat")
    assert [x["w"] for x in demo.list_word_practice("s-maya")] == ["habitat"]
    # word items don't leak into the session/assignment listings
    assert demo.list_sessions_for_student("s-maya") == []


# -- encoding & module API -----------------------------------------------------

def test_no_floats_reach_dynamodb(demo, table):
    demo.append_session("s-maya", "k2", 2.5, session_id="r9")
    stored = [i for i in table.items.values() if i.get("id") == "r9"][0]
    assert stored["minutes"] == Decimal("2.5")
    assert "q" not in stored   # None dropped


def test_strip_keys():
    item = ps.person_item("s-a", "student", "Al", now=NOW)
    assert set(ps.strip_keys(item)) & set(ps.KEY_ATTRS) == set()


def test_module_level_functions_use_env_table(monkeypatch, table):
    monkeypatch.setitem(ps._cache, "store", ps.PeopleStore(table))
    ps.put_person("s-a", "student", "Al")
    assert ps.get_person("s-a")["name"] == "Al"
    for name in ("get_person_by_sub", "list_people_by_role", "put_person", "link_parent_student",
                 "link_teacher_class", "enrol_student", "list_children", "list_class_students",
                 "list_teacher_classes", "put_assignment", "list_assignments_for_student",
                 "append_session", "list_sessions_for_student", "attach_cognito_sub"):
        assert callable(getattr(ps, name))


def test_get_store_reads_people_table_env(monkeypatch):
    monkeypatch.setenv("PEOPLE_TABLE", "dynamodb-test-people")
    monkeypatch.delitem(ps._cache, "store", raising=False)
    try:
        assert ps.get_store().table.name == "dynamodb-test-people"   # no AWS call
    finally:
        ps._cache.pop("store", None)


# -- seed script -----------------------------------------------------------------

def test_seed_is_rerunnable(store):
    first = seed_people.seed(store, log=lambda *_: None)
    assert first == {"people": 35, "classes": 4, "links": 4 + 24 + 7, "skipped": 0}
    second = seed_people.seed(store, log=lambda *_: None)
    assert second["people"] == second["classes"] == second["links"] == 0
    assert second["skipped"] == 35 + 4 + 35


def test_seed_dry_run_writes_nothing(capsys):
    assert seed_people.main(["--table", "x"]) == 0
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert len(lines) == 35 + 4 + 35
    assert all(not item["sub"] for item in lines if item["type"] == "person")
    assert not any("arch" in item or "email" in item for item in lines)


def test_seed_cast_matches_frontend_people_js():
    src = (REPO / "frontend" / "src" / "people.js")
    if not src.exists():
        pytest.skip("frontend/src/people.js not present")
    js = src.read_text()
    students = re.findall(r"S\('([\w-]+)', '([^']+)', '(c\d+)', '\w+'\)", js)
    assert [("s-" + i, n, c) for i, n, c in students] == [
        (s["id"], s["name"], s["cls"]) for s in seed_people.DEMO["students"]]
    classes = re.findall(r"\{ id: '(c\d+)', name: '([^']+)', grade: (\d+), band: '(\w+)', teacher: '([\w-]+)' \}", js)
    assert [(i, n, int(g), b, t) for i, n, g, b, t in classes] == [
        (c["id"], c["name"], c["grade"], c["band"], c["teacher"]) for c in seed_people.DEMO["classes"]]
    teachers = re.findall(r"\{ id: '(t-[\w-]+)', name: '([^']+)', cls: '(c\d+)' \}", js)
    assert [(i, n, c) for i, n, c in teachers] == [
        (t["id"], t["name"], t["cls"]) for t in seed_people.DEMO["teachers"]]
    parents = re.findall(r"\{ id: '(p-[\w-]+)', name: '([^']+)', kids: \[([^\]]*)\] \}", js)
    assert [(i, n, re.findall(r"'([\w-]+)'", k)) for i, n, k in parents] == [
        (p["id"], p["name"], p["kids"]) for p in seed_people.DEMO["parents"]]
