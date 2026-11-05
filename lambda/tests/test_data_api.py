"""Offline tests for the app-data API (roster, sessions, assignments,
practice, ratings, review). An in-memory fake stands in for the DynamoDB
table + type-index GSI. No AWS calls."""
import json

import pytest

from common import data_store
from data_api import handler as h


class FakeTable:
    """Minimal DynamoDB Table: get/put/delete + a type-index query."""

    def __init__(self):
        self.items = {}

    def put_item(self, Item):
        self.items[Item["id"]] = dict(Item)

    def get_item(self, Key):
        it = self.items.get(Key["id"])
        return {"Item": dict(it)} if it else {}

    def delete_item(self, Key):
        self.items.pop(Key["id"], None)

    def query(self, IndexName, KeyConditionExpression, Limit=None):
        # KeyConditionExpression is Key("type").eq(<value>); pull the value out.
        want = KeyConditionExpression._values[1]
        rows = [dict(v) for v in self.items.values() if v.get("type") == want]
        return {"Items": rows}


@pytest.fixture
def table(monkeypatch):
    t = FakeTable()
    monkeypatch.setattr(data_store, "_table", t)
    monkeypatch.setattr(data_store, "_get_table", lambda: t)
    return t


def call(method, resource, body=None, qs=None):
    event = {
        "requestContext": {"http": {"method": method, "path": f"/api/v1/data/{resource}"}},
        "queryStringParameters": qs,
        "body": json.dumps(body) if body is not None else None,
    }
    resp = h.handler(event, None)
    return resp["statusCode"], json.loads(resp["body"])


def test_roster_empty_then_seeded(table):
    s, b = call("GET", "roster")
    assert s == 200 and b == {"classes": [], "teachers": [], "students": [], "parents": []}
    data_store.put("student", "s-maya", {"name": "Maya Chen", "cls": "c2", "arch": "steady"})
    data_store.put("class", "c2", {"name": "Room 4", "grade": 2, "band": "k2", "teacher": "t-rivera"})
    s, b = call("GET", "roster")
    assert s == 200 and len(b["students"]) == 1 and b["students"][0]["id"] == "s-maya"
    assert b["classes"][0]["name"] == "Room 4"


def test_session_roundtrip(table):
    s, b = call("POST", "sessions", {"student": "s-maya", "pid": "35", "minutes": 4.2,
                                     "words": ["habitat"], "q": 88, "source": "assigned", "stars": 3})
    assert s == 201 and b["student"] == "s-maya" and b["minutes"] == 4.2
    s, rows = call("GET", "sessions", qs={"student": "s-maya"})
    assert s == 200 and len(rows) == 1 and rows[0]["pid"] == "35"
    s, none = call("GET", "sessions", qs={"student": "s-nobody"})
    assert s == 200 and none == []


def test_sessions_require_student(table):
    assert call("GET", "sessions")[0] == 400
    assert call("POST", "sessions", {"pid": "35"})[0] == 400


def test_assignments_crud(table):
    s, a = call("POST", "assignments", {"pid": "68", "to": "s-maya", "by": "t-rivera", "byName": "Ms. Rivera"})
    assert s == 201
    aid = a["id"]
    s, rows = call("GET", "assignments", qs={"student": "s-maya"})
    assert s == 200 and len(rows) == 1
    s, _ = call("DELETE", "assignments", qs={"id": aid})
    assert s == 200
    assert call("GET", "assignments", qs={"student": "s-maya"})[1] == []


def test_practice_accumulates(table):
    call("POST", "practice", {"student": "s-leo", "word": "Erosion", "knew": True})
    call("POST", "practice", {"student": "s-leo", "word": "erosion", "knew": False})
    s, rows = call("GET", "practice", qs={"student": "s-leo"})
    assert s == 200 and len(rows) == 1
    assert rows[0]["word"] == "erosion" and rows[0]["k"] == 1 and rows[0]["m"] == 1


def test_ratings_newest_first(table):
    call("POST", "ratings", {"passage": "35", "helpful": True, "audioGood": True, "voice": "Danielle"})
    call("POST", "ratings", {"passage": "68", "helpful": False, "audioGood": True, "comment": "x" * 999})
    s, rows = call("GET", "ratings")
    assert s == 200 and len(rows) == 2
    assert len(rows[0]["comment"]) <= 500  # clamped
    assert all("helpful" in r for r in rows)


def test_review_state(table):
    s, b = call("GET", "review", qs={"pid": "35"})
    assert s == 200 and b["state"] == "none"
    s, b = call("POST", "review", {"pid": "35", "state": "published", "by": "t-rivera"})
    assert s == 201 and b["state"] == "published"
    assert call("GET", "review", qs={"pid": "35"})[1]["state"] == "published"
    assert call("POST", "review", {"pid": "35", "state": "bogus"})[0] == 400


def test_translate(table, monkeypatch):
    from common import translate as tr
    monkeypatch.setattr(tr, "_client", type("C", (), {
        "translate_text": lambda self, **kw: {"TranslatedText": "[es] " + kw["Text"]}})())
    s, b = call("POST", "translate", {"text": "Hello world", "target": "es"})
    assert s == 200 and b["text"] == "[es] Hello world"
    assert call("POST", "translate", {"text": "  "})[0] == 400


def test_translate_same_language_is_passthrough(table, monkeypatch):
    from common import translate as tr
    # en->en should not call the service at all.
    monkeypatch.setattr(tr, "_client", None)
    s, b = call("POST", "translate", {"text": "Hola", "source": "es", "target": "es"})
    assert s == 200 and b["text"] == "Hola"


def _fake_bedrock(reply):
    """A bedrock-runtime client whose converse() returns `reply` as the text."""
    return type("B", (), {"converse": lambda self, **kw: {
        "output": {"message": {"content": [{"text": reply}]}}}})()


def test_cards_keeps_only_in_passage_words(table, monkeypatch):
    from common import generate as gen
    text = "The fox lives in a warm burrow under the hill."
    reply = json.dumps([
        {"word": "burrow", "def": "a hole an animal digs to live in", "ex": "The fox slept in its burrow."},
        {"word": "spaceship", "def": "not in the passage", "ex": "x"},  # dropped: not present
    ])
    monkeypatch.setattr(gen, "_client", _fake_bedrock(reply))
    s, b = call("POST", "cards", {"text": text})
    assert s == 200 and [c["word"] for c in b["cards"]] == ["burrow"]


def test_stops_pass_the_four_checks(table, monkeypatch):
    from common import generate as gen
    text = "Erosion slowly wears away the rock along the river over many years."
    good = {"word": "erosion", "def": "the wearing away of rock",
            "clue": "wears away the rock",
            "choices": [{"text": "the wearing away of rock", "correct": True},
                        {"text": "a kind of fish", "correct": False},
                        {"text": "a loud sound", "correct": False},
                        {"text": "a type of cloud", "correct": False}]}
    bad_clue = {**good, "word": "erosion", "clue": "volcanoes erupt loudly"}  # clue words not in passage
    two_correct = {**good, "choices": [{"text": "the wearing away of rock", "correct": True},
                                       {"text": "a kind of fish", "correct": True},
                                       {"text": "x", "correct": False}, {"text": "y", "correct": False}]}
    not_vocab = {**good, "word": "river"}  # not in the target vocab list
    monkeypatch.setattr(gen, "_client", _fake_bedrock(json.dumps([good, bad_clue, two_correct, not_vocab])))
    s, b = call("POST", "stops", {"text": text, "vocab": ["erosion"]})
    assert s == 200 and len(b["stops"]) == 1
    assert b["stops"][0]["word"] == "erosion"
    assert sum(1 for c in b["stops"][0]["choices"] if c["correct"]) == 1


def test_cards_and_stops_require_text(table):
    assert call("POST", "cards", {})[0] == 400
    assert call("POST", "stops", {"vocab": ["x"]})[0] == 400


def test_pcards_roundtrip(table):
    # Save per-passage vocab cards, then read them back.
    s, b = call("POST", "pcards", {"pid": "p-x-en", "cards": [
        {"word": "glow", "def": "to shine", "ex": "The lights glow."},
        {"word": "", "def": "dropped"},  # no word -> dropped
    ]})
    assert s == 201 and [c["word"] for c in b["cards"]] == ["glow"]
    s, b = call("GET", "pcards", qs={"pid": "p-x-en"})
    assert s == 200 and b["cards"][0]["word"] == "glow"


def test_pcards_unknown_returns_empty(table):
    s, b = call("GET", "pcards", qs={"pid": "nope"})
    assert s == 200 and b["cards"] == []


def test_localize_matches_passage(table, monkeypatch):
    from common import generate as gen
    reply = json.dumps([{"word": "brillan", "def": "dar luz", "ex": "Las luces brillan."}])
    monkeypatch.setattr(gen, "_client", type("B", (), {"converse": lambda self, **kw: {
        "output": {"message": {"content": [{"text": reply}]}}, "stopReason": "end_turn"}})())
    s, b = call("POST", "localize", {
        "text": "Las luces doradas brillan suavemente en la casa.",
        "cards": [{"word": "glow", "def": "to shine"}], "lang": "es"})
    assert s == 200 and [c["word"] for c in b["cards"]] == ["brillan"]


def test_unknown_resource_404(table):
    assert call("GET", "nope")[0] == 404
    assert call("PUT", "roster")[0] == 404  # method not routed
