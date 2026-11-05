"""Sound Along app data API — /api/v1/data

One HTTP API Lambda for every non-passage domain, all stored in the shared
reference table (common/data_store.py). The resource is the last path
segment; the method decides the action.

  Roster (seeded once, then read-only from the app):
    GET  /api/v1/data/roster                 -> {classes, teachers, students, parents}

  Reading sessions (the player records these as a student reads):
    GET  /api/v1/data/sessions?student=<id>  -> [session, ...]
    POST /api/v1/data/sessions  {student, pid, minutes, words, q?, source, stars}

  Assignments (a teacher or parent pushes a passage):
    GET    /api/v1/data/assignments?student=<id>
    POST   /api/v1/data/assignments  {pid, to, by, byName, due?}
    DELETE /api/v1/data/assignments?id=<id>

  Word practice:
    GET  /api/v1/data/practice?student=<id>
    POST /api/v1/data/practice  {student, word, knew}

  Ratings:
    GET  /api/v1/data/ratings                -> [rating, ...] (newest first)
    POST /api/v1/data/ratings  {passage, audio, voice, helpful, audioGood, comment?}

  Review / publish state:
    GET  /api/v1/data/review?pid=<id>
    POST /api/v1/data/review  {pid, state, by?, notes?}

  Content (migrated built-in passages): the player's catalog, shared vocab
  cards, and one passage/mode by id. Seeded by lambda/scripts/seed_content.py.
    GET /api/v1/data/catalog            -> {entries: [...], cards: {...}}
    GET /api/v1/data/content?id=<modeId> -> the mode (paras, stops, questions, ...)

  Translate (Spanish version): translates text so the caller can then POST it
  to /text-to-speech as a normal passage (same pipeline, es-US voices).
    POST /api/v1/data/translate  {text, source?, target?}  -> {text}

  Generation (Amazon Bedrock): vocabulary cards and Word Stops drafted from a
  passage. Word Stops pass four publish checks server-side; failures drop.
    POST /api/v1/data/cards  {text, lang?}          -> {cards: [...]}
    POST /api/v1/data/stops  {text, vocab:[...], lang?} -> {stops: [...]}

CORS and preflight are handled by the HTTP API (infra/cdk ApiStack).
"""

import json

from common import data_store as db
from common import generate as gen
from common.responses import error_response, json_response
from common.translate import translate_text


def _resource(event):
    # HTTP API payload v2 puts the matched route in requestContext; fall back to rawPath.
    ctx = (event.get("requestContext") or {}).get("http") or {}
    path = ctx.get("path") or event.get("rawPath") or event.get("path") or ""
    method = ctx.get("method") or event.get("httpMethod") or "GET"
    resource = path.rstrip("/").rsplit("/", 1)[-1]
    return resource, method.upper()


def _body(event):
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        import base64
        raw = base64.b64decode(raw).decode("utf-8")
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except (ValueError, TypeError):
        return None


def _q(event, name):
    return (event.get("queryStringParameters") or {}).get(name)


def handler(event, context):
    resource, method = _resource(event)
    try:
        fn = ROUTES.get((resource, method))
        if not fn:
            return error_response(404, f"No {method} /{resource}")
        return fn(event)
    except KeyError as exc:
        return error_response(400, f"Missing field: {exc}")
    except Exception as exc:  # noqa: BLE001 - surface as 500, logged by Lambda
        return error_response(500, f"{type(exc).__name__}: {exc}")


# ---- roster ---------------------------------------------------------------
def get_roster(event):
    return json_response(200, {
        "classes": db.list_type("class"),
        "teachers": db.list_type("teacher"),
        "students": db.list_type("student"),
        "parents": db.list_type("parent"),
    })


# ---- sessions -------------------------------------------------------------
def get_sessions(event):
    student = _q(event, "student")
    if not student:
        return error_response(400, "student is required")
    rows = [s for s in db.list_type("session") if s.get("student") == student]
    rows.sort(key=lambda s: s.get("at", ""), reverse=True)
    return json_response(200, rows)


def post_session(event):
    b = _body(event)
    if b is None or not b.get("student") or not b.get("pid"):
        return error_response(400, "student and pid are required")
    at = db.now_iso()
    sid = f"{b['student']}#{at}#{db.new_id()}"
    rec = db.put("session", sid, {
        "student": b["student"], "pid": b["pid"], "at": at,
        "minutes": b.get("minutes", 0), "words": b.get("words", []),
        "q": b.get("q"), "source": b.get("source", "independent"),
        "stars": b.get("stars", 1),
    })
    return json_response(201, rec)


# ---- assignments ----------------------------------------------------------
def get_assignments(event):
    student = _q(event, "student")
    rows = db.list_type("assign")
    if student:
        rows = [a for a in rows if a.get("to") == student]
    rows.sort(key=lambda a: a.get("due", ""))
    return json_response(200, rows)


def post_assignment(event):
    b = _body(event)
    if b is None or not b.get("pid") or not b.get("to"):
        return error_response(400, "pid and to are required")
    aid = db.new_id()
    rec = db.put("assign", aid, {
        "pid": b["pid"], "to": b["to"], "by": b.get("by"), "byName": b.get("byName"),
        "at": db.now_iso(), "due": b.get("due"),
    })
    return json_response(201, rec)


def delete_assignment(event):
    aid = _q(event, "id")
    if not aid:
        return error_response(400, "id is required")
    db.delete("assign", aid)
    return json_response(200, {"ok": True})


# ---- practice -------------------------------------------------------------
def get_practice(event):
    student = _q(event, "student")
    if not student:
        return error_response(400, "student is required")
    rows = [p for p in db.list_type("practice") if p.get("student") == student]
    return json_response(200, rows)


def post_practice(event):
    b = _body(event)
    if b is None or not b.get("student") or not b.get("word"):
        return error_response(400, "student and word are required")
    word = str(b["word"]).lower()
    pid = f"{b['student']}#{word}"
    cur = db.get("practice", pid) or {"student": b["student"], "word": word, "k": 0, "m": 0}
    if b.get("knew"):
        cur["k"] = cur.get("k", 0) + 1
    else:
        cur["m"] = cur.get("m", 0) + 1
    cur["at"] = db.now_iso()
    cur.pop("id", None)
    return json_response(201, db.put("practice", pid, cur))


# ---- ratings --------------------------------------------------------------
def get_ratings(event):
    rows = db.list_type("rating")
    rows.sort(key=lambda r: r.get("at", ""), reverse=True)
    return json_response(200, rows)


def post_rating(event):
    b = _body(event)
    if b is None:
        return error_response(400, "JSON body required")
    at = db.now_iso()
    rid = f"{at}#{db.new_id()}"
    rec = db.put("rating", rid, {
        "passage": b.get("passage", ""), "audio": b.get("audio", ""),
        "voice": b.get("voice", ""), "helpful": bool(b.get("helpful")),
        "audioGood": bool(b.get("audioGood")), "comment": (b.get("comment") or "")[:500],
        "at": at,
    })
    return json_response(201, rec)


# ---- review ---------------------------------------------------------------
def get_review(event):
    pid = _q(event, "pid")
    if not pid:
        return error_response(400, "pid is required")
    rec = db.get("review", pid)
    return json_response(200, rec or {"pid": pid, "state": "none"})


def post_review(event):
    b = _body(event)
    if b is None or not b.get("pid") or not b.get("state"):
        return error_response(400, "pid and state are required")
    if b["state"] not in ("draft", "review", "published", "rejected"):
        return error_response(400, "state must be draft|review|published|rejected")
    rec = db.put("review", b["pid"], {
        "pid": b["pid"], "state": b["state"], "by": b.get("by"),
        "notes": (b.get("notes") or "")[:1000], "at": db.now_iso(),
    })
    return json_response(201, rec)


# ---- content (migrated built-in passages) ---------------------------------
def get_catalog(event):
    cat = db.get_raw("catalog", "index") or {"entries": []}
    cards = db.get_raw("cards", "index") or {"cards": {}}
    return json_response(200, {"entries": cat.get("entries", []), "cards": cards.get("cards", {})})


def get_content(event):
    mode_id = _q(event, "id")
    if not mode_id:
        return error_response(400, "id is required")
    rec = db.get("content", mode_id)
    if rec is None:
        return error_response(404, f"No content for id '{mode_id}'")
    return json_response(200, rec)


# ---- translate ------------------------------------------------------------
def post_translate(event):
    b = _body(event)
    if b is None or not b.get("text") or not str(b["text"]).strip():
        return error_response(400, "text is required")
    try:
        out = translate_text(str(b["text"]), b.get("source", "en"), b.get("target", "es"))
    except ValueError as exc:
        return error_response(400, str(exc))
    return json_response(200, {"text": out})


# ---- generation (Bedrock) -------------------------------------------------
def post_cards(event):
    b = _body(event)
    if b is None or not b.get("text") or not str(b["text"]).strip():
        return error_response(400, "text is required")
    cards = gen.vocab_cards(str(b["text"]), b.get("lang", "en"))
    return json_response(200, {"cards": cards})


def post_stops(event):
    b = _body(event)
    if b is None or not b.get("text") or not str(b["text"]).strip():
        return error_response(400, "text is required")
    vocab = b.get("vocab") or []
    if not isinstance(vocab, list):
        return error_response(400, "vocab must be an array of words")
    stops = gen.word_stops(str(b["text"]), [str(v) for v in vocab], b.get("lang", "en"))
    return json_response(200, {"stops": stops})


ROUTES = {
    ("roster", "GET"): get_roster,
    ("catalog", "GET"): get_catalog,
    ("content", "GET"): get_content,
    ("translate", "POST"): post_translate,
    ("cards", "POST"): post_cards,
    ("stops", "POST"): post_stops,
    ("sessions", "GET"): get_sessions,
    ("sessions", "POST"): post_session,
    ("assignments", "GET"): get_assignments,
    ("assignments", "POST"): post_assignment,
    ("assignments", "DELETE"): delete_assignment,
    ("practice", "GET"): get_practice,
    ("practice", "POST"): post_practice,
    ("ratings", "GET"): get_ratings,
    ("ratings", "POST"): post_rating,
    ("review", "GET"): get_review,
    ("review", "POST"): post_review,
}
