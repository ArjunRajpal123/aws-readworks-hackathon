"""GET /api/v1/text-to-speech?id=...[&lang=...][&voiceId=...]

Fetches a Sound Along product record by passage id straight from
sa/product/<id>.soundAlong.json in the shared media bucket (written by the
pipeline: the API's POST or the ETL's run_aws.py) and adds fresh presigned
URLs for each track's audio and timing file under `urls`. Reading the S3
file itself, rather than the DynamoDB mirror, keeps the response
byte-identical to the stored product record.

voiceId (optional, e.g. the player's voice picker: "Stephen") picks one
track: that voice if it has a track whose QA didn't fail, otherwise the
default track. The response then names it in `selectedTrack` and `urls`
holds only that track. Without voiceId every track gets URLs, as before.

lang (optional: "en"/"es", or "en-US"/"es-US" like the POST) asks for that
language's version of the passage. Each language is its own record, so when
`id` is in the other language its sibling id is used: <id>-en <-> <id>-es
(rws-e1-en, g-k1q1-en, ...) or <id> <-> <id>es (the demo passages: 35, 35es).
404 if that language has no version.
"""

import re

from common.responses import error_response, json_response
from common.s3_store import get_product, with_urls


SUPPORTED_LANGS = ("en", "es")


def _lang2(raw):
    lang = raw.strip().lower()[:2]
    return lang if lang in SUPPORTED_LANGS else None


def sibling_id(record_id, lang):
    """The id of record_id's version in `lang`, by the player's id conventions."""
    m = re.match(r"^(.*)-(en|es)$", record_id)
    if m:
        return f"{m.group(1)}-{lang}"
    base = record_id[:-2] if record_id.endswith("es") else record_id
    return base + "es" if lang == "es" else base


def select_track(record, voice_id):
    """Track id for voice_id: that voice, else the default, else any usable track."""
    usable = [t for t in record.get("tracks") or []
              if (t.get("qa") or {}).get("status") != "failed"]
    want = voice_id.strip().lower()
    for pick in (lambda t: str(t.get("voiceId", "")).lower() == want,
                 lambda t: t.get("default"),
                 lambda t: True):
        for t in usable:
            if pick(t):
                return t["id"]
    return None


def handler(event, context):
    params = event.get("queryStringParameters") or {}
    record_id = params.get("id")
    if not record_id:
        return error_response(400, "Query parameter 'id' is required")

    lang = None
    if params.get("lang") or params.get("languageCode"):
        lang = _lang2(params.get("lang") or params.get("languageCode"))
        if lang is None:
            return error_response(400, f"'lang' must be one of: {', '.join(SUPPORTED_LANGS)}")

    record = get_product(record_id)
    if record is None:
        return error_response(404, f"No record found for id '{record_id}'")
    if lang and record.get("lang") != lang:
        other = sibling_id(record_id, lang)
        record = get_product(other) if other != record_id else None
        if record is None or record.get("lang") != lang:
            return error_response(404, f"No '{lang}' version of '{record_id}' (looked for '{other}')")

    voice_id = params.get("voiceId")
    if not voice_id:
        return json_response(200, with_urls(record))

    track_id = select_track(record, voice_id)
    if track_id is None:
        return error_response(404, f"No usable audio track for id '{record_id}'")
    out = with_urls(record, track_ids=[track_id])
    out["selectedTrack"] = track_id
    return json_response(200, out)
