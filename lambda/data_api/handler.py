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
    POST /api/v1/data/review  {pid, state, by?, notes?, meta?}
    GET  /api/v1/data/published              -> {entries: [...]} approved generated
                                                passages (state=published + a band in meta)

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


_BANDS = ("k2", "35", "68", "912")
_BAND_LABEL = {"k2": "K–2", "35": "3–5", "68": "6–8", "912": "9–12"}


def _clean_meta(m):
    """Catalog metadata a generated passage needs to be listed in the player:
    where it belongs (grade band) and how to label it. Unknown keys are dropped."""
    if not isinstance(m, dict):
        return None
    out = {}
    for key, cap in (("title", 200), ("grade", 8), ("genre", 30), ("lexile", 12), ("topic", 60)):
        v = m.get(key)
        if isinstance(v, str) and v.strip():
            out[key] = v.strip()[:cap]
    if m.get("band") in _BANDS:
        out["band"] = m["band"]
    return out or None


def post_review(event):
    b = _body(event)
    if b is None or not b.get("pid") or not b.get("state"):
        return error_response(400, "pid and state are required")
    if b["state"] not in ("draft", "review", "published", "rejected"):
        return error_response(400, "state must be draft|review|published|rejected")
    # A later review write (e.g. Approve) that doesn't resend the metadata must
    # not erase what the submit stored, so keep the previous meta in that case.
    prev = db.get("review", b["pid"]) or {}
    meta = _clean_meta(b.get("meta")) or prev.get("meta")
    item = {
        "pid": b["pid"], "state": b["state"], "by": b.get("by"),
        "notes": (b.get("notes") or "")[:1000], "at": db.now_iso(),
    }
    if meta:
        item["meta"] = meta
    return json_response(201, db.put("review", b["pid"], item))


def get_published(event):
    """Approved generated passages, for the player's passage list. A passage is
    listed once it is `published` AND has a grade band (stored with its review
    at submit time); the library catalog itself is untouched."""
    out = []
    for r in db.list_type("review"):
        meta = r.get("meta") or {}
        if r.get("state") != "published" or meta.get("band") not in _BANDS:
            continue
        pid = r.get("pid") or r.get("id")
        grade = str(meta.get("grade", ""))
        out.append({
            "pid": pid, "title": meta.get("title") or pid, "band": meta["band"],
            # The dropdown shows "Grade 4" for a number and "Grades 3–5" otherwise,
            # so fall back to the band's range when no numeric grade was entered.
            "grade": grade if grade.isdigit() else _BAND_LABEL[meta["band"]],
            "genre": meta.get("genre", ""), "lexile": meta.get("lexile", ""),
            "lang": "es" if pid.endswith("-es") else "en",
        })
    out.sort(key=lambda p: p["title"].lower())
    return json_response(200, {"entries": out})


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


# ---- delete a passage and everything generated for it ---------------------
import os  # noqa: E402

_s3 = None


def _s3_client():
    global _s3
    if _s3 is None:
        import boto3
        _s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-west-2"))
    return _s3


def _delete_s3_prefixes(bucket, prefixes):
    """Delete every object under each prefix. Best-effort count."""
    s3 = _s3_client()
    deleted = 0
    for prefix in prefixes:
        token = None
        while True:
            kw = {"Bucket": bucket, "Prefix": prefix}
            if token:
                kw["ContinuationToken"] = token
            resp = s3.list_objects_v2(**kw)
            objs = [{"Key": o["Key"]} for o in resp.get("Contents", []) or []]
            if objs:
                s3.delete_objects(Bucket=bucket, Delete={"Objects": objs, "Quiet": True})
                deleted += len(objs)
            token = resp.get("NextContinuationToken")
            if not token:
                break
    return deleted


def delete_passage(event):
    """Remove a passage and ALL its generated artifacts, for both language
    siblings of a base id: the product records (S3 sa/product + sa/audio and
    the DynamoDB item), the per-passage vocab cards, and the review state.

    id may be the base (<base>) or either sibling (<base>-en / <base>-es);
    both -en and -es are removed so "delete" is complete.
    """
    raw = _q(event, "id")
    if not raw:
        return error_response(400, "id is required")
    # Normalize to a base, then expand to both siblings.
    base = raw[:-3] if raw.endswith(("-en", "-es")) else raw
    ids = [f"{base}-en", f"{base}-es", base]  # include the bare base just in case
    ids = list(dict.fromkeys(ids))            # de-dupe, keep order

    bucket = os.environ.get("TTS_MEDIA_BUCKET")
    removed = {"products": [], "s3Objects": 0, "pcards": [], "review": []}
    table = db._get_table()
    for pid in ids:
        # product record (bare id, no type) — only if it exists
        got = table.get_item(Key={"id": pid}).get("Item")
        if got:
            table.delete_item(Key={"id": pid})
            removed["products"].append(pid)
            if bucket:
                removed["s3Objects"] += _delete_s3_prefixes(
                    bucket, [f"sa/product/{pid}.soundAlong.json", f"sa/audio/{pid}/"])
        # typed items: per-passage cards + review state
        if db.get("pcards", pid) is not None:
            db.delete("pcards", pid); removed["pcards"].append(pid)
        if db.get("review", pid) is not None:
            db.delete("review", pid); removed["review"].append(pid)
    if not removed["products"] and not removed["pcards"] and not removed["review"]:
        return error_response(404, f"No passage found for '{raw}'")
    return json_response(200, {"deleted": base, **removed})


# ---- per-passage vocab cards for the player (underlining) -----------------
# Generated cards saved against a passage id so the player can underline and
# open them. Keyed by the passage/mode id; the player's pipeline_mode.js reads
# this to mark vocab tokens.
def get_pcards(event):
    pid = _q(event, "pid")
    if not pid:
        return error_response(400, "pid is required")
    rec = db.get("pcards", pid)
    return json_response(200, rec or {"pid": pid, "cards": []})


def post_pcards(event):
    b = _body(event)
    if b is None or not b.get("pid"):
        return error_response(400, "pid is required")
    cards = b.get("cards") or []
    if not isinstance(cards, list):
        return error_response(400, "cards must be an array")
    # Keep only the fields the player needs.
    clean = [{"word": str(c.get("word", ""))[:40],
              "def": str(c.get("def", ""))[:300],
              "ex": str(c.get("ex", ""))[:300]}
             for c in cards if isinstance(c, dict) and c.get("word")]
    rec = db.put("pcards", b["pid"], {"pid": b["pid"], "cards": clean})
    return json_response(201, rec)


# ---- localize cards to the sibling language, matched to the passage --------
def post_localize(event):
    b = _body(event)
    if b is None or not b.get("text") or not str(b["text"]).strip():
        return error_response(400, "text (the translated passage) is required")
    cards = b.get("cards") or []
    if not isinstance(cards, list):
        return error_response(400, "cards must be an array")
    out = gen.localize_cards([c for c in cards if isinstance(c, dict)],
                             str(b["text"]), b.get("lang", "es"))
    return json_response(200, {"cards": out})


# ---- autofill passage metadata (Bedrock) ----------------------------------
def post_autofill(event):
    b = _body(event)
    if b is None or not b.get("text") or not str(b["text"]).strip():
        return error_response(400, "text is required")
    fields = gen.autofill_fields(str(b["text"]), b.get("lang"))
    return json_response(200, {"fields": fields})


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
    ("autofill", "POST"): post_autofill,
    ("localize", "POST"): post_localize,
    ("pcards", "GET"): get_pcards,
    ("pcards", "POST"): post_pcards,
    ("passage", "DELETE"): delete_passage,
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
    ("published", "GET"): get_published,
}
