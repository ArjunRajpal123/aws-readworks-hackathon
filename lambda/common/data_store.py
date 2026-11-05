"""Single-table data access for the Sound Along app domains.

All app data (student roster, profiles, reading sessions, assignments, word
practice, ratings, review state) lives in the same DynamoDB reference table
as the passage product records (StorageStack), keyed by a typed `id`:

    student#<sid>            one roster student
    class#<cid>              one class
    teacher#<tid>            one teacher
    parent#<pid>             one parent
    profile#<who>            the signed-in profile pointer (demo: a single row)
    session#<sid>#<ts>       a reading session for a student
    assign#<id>              an assignment
    practice#<sid>#<word>    a word-practice tally
    rating#<ts>#<rand>       a student rating
    review#<pid>             review/publish state for a passage

A `type` attribute mirrors the prefix and backs the existing `lang-index`
GSI's sibling `type-index` so each domain can be listed without a full scan.
Passage product records (no `type`) are untouched by this module.
"""

import os
import time
import uuid
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

_table = None


def _get_table():
    global _table
    if _table is None:
        _table = boto3.resource("dynamodb").Table(os.environ["TTS_REFERENCE_TABLE"])
    return _table


def _clean(value):
    """boto3 rejects floats; store them as Decimal, drop Nones, keep the rest."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [_clean(v) for v in value]
    return value


def _from_dynamo(value):
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, list):
        return [_from_dynamo(v) for v in value]
    if isinstance(value, dict):
        return {k: _from_dynamo(v) for k, v in value.items()}
    return value


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def put(item_type, item_id, body):
    """Upsert one item. Returns the stored item (minus internal keys echoed back)."""
    item = _clean(dict(body))
    item["id"] = f"{item_type}#{item_id}"
    item["type"] = item_type
    _get_table().put_item(Item=item)
    return get(item_type, item_id)


def get(item_type, item_id):
    resp = _get_table().get_item(Key={"id": f"{item_type}#{item_id}"})
    item = resp.get("Item")
    return _strip(_from_dynamo(item)) if item else None


def delete(item_type, item_id):
    _get_table().delete_item(Key={"id": f"{item_type}#{item_id}"})


def list_type(item_type, limit=500):
    """Every item of one type, via the type-index GSI (no full-table scan)."""
    resp = _get_table().query(
        IndexName="type-index",
        KeyConditionExpression=Key("type").eq(item_type),
        Limit=limit,
    )
    return [_strip(_from_dynamo(i)) for i in resp.get("Items", [])]


def new_id():
    return f"{int(time.time() * 1000):x}{uuid.uuid4().hex[:6]}"


# Passage product records predate the typed app-data items: their id is the
# bare passage id (no "#"), they carry `lang` and `tracks`, and no `type`.
# They're listed off the existing lang-index GSI so the browse page can show
# every cloud/ETL/API passage without a full-table scan.
def get_raw(item_type, item_id):
    """get() without stripping the typed id (for large index items)."""
    resp = _get_table().get_item(Key={"id": f"{item_type}#{item_id}"})
    item = resp.get("Item")
    return _from_dynamo(item) if item else None


# Both casings: the pipeline writes lowercase "en"/"es", but some legacy API
# records used "EN"/"ES". lang-index is case-sensitive, so query all four.
_PASSAGE_LANGS = ("en", "es", "EN", "ES")


def list_passages(limit=500):
    """Compact list of passage product records: {id, title, lang, tracks[], generatedAt}."""
    table = _get_table()
    out = []
    for lang in _PASSAGE_LANGS:
        resp = table.query(
            IndexName="lang-index",
            KeyConditionExpression=Key("lang").eq(lang),
            Limit=limit,
        )
        for item in resp.get("Items", []):
            raw = item.get("id", "")
            if "#" in raw or not item.get("tracks"):
                continue  # skip typed app-data rows and non-passage items
            out.append({
                "id": raw,
                "title": item.get("title", raw),
                "lang": item.get("lang"),
                "voices": [t.get("voiceId") for t in item.get("tracks", []) if t.get("voiceId")],
                "generatedAt": (item.get("generation") or {}).get("runAt"),
            })
    out.sort(key=lambda p: p.get("title", "").lower())
    return _from_dynamo(out)


def _strip(item):
    """Return the item with the typed `id`/`type` reduced to a bare id."""
    if not item:
        return item
    raw = item.get("id", "")
    item = dict(item)
    item["id"] = raw.split("#", 1)[1] if "#" in raw else raw
    item.pop("type", None)
    return item
