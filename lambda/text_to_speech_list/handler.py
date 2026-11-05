"""GET /api/v1/passages

Lists every Sound Along passage that has been generated, so the player can
show user-entered passages (created via POST /api/v1/text-to-speech or the
cloud ETL) in its passage picker alongside the ones built into the app.

Reads the shared DynamoDB reference table (one item per passage, written by
the pipeline) and returns a lightweight summary per passage — just what the
player needs to list and open it, not the full product record or any URLs:

    { "passages": [ { "id": "...", "title": "...", "lang": "en",
                      "band": "35", "tracks": ["Danielle", "Stephen"] }, ... ] }

The per-passage audio (and presigned URLs) is still fetched one id at a time
through GET /api/v1/text-to-speech when the student actually opens a passage.
"""

from common.reference_store import scan_records
from common.responses import error_response, json_response


# Attributes projected from each table item. Keeping this narrow makes the
# scan cheap and the response small; everything else lives on the full record
# fetched by GET /api/v1/text-to-speech when a passage is opened.
_PROJECTION = ["id", "lang", "title", "band", "tracks", "review"]


def _summary(record):
    """A minimal, player-facing summary of one product record."""
    voices = []
    for track in record.get("tracks") or []:
        voice = track.get("voiceId")
        if voice and voice not in voices:
            voices.append(voice)
    review = record.get("review") or {}
    return {
        "id": record.get("id"),
        "title": record.get("title") or record.get("id"),
        "lang": record.get("lang") or "en",
        # `band` is optional on the record; the player decides where to group
        # a passage that has none (its "My Passages" section).
        "band": record.get("band"),
        "tracks": voices,
        # Review state for AI-generated (e.g. machine-translated) passages so
        # the UI can show a "pending review" badge. Absent for human content.
        "reviewStatus": review.get("reviewStatus"),
        "provenance": review.get("provenance"),
    }


def handler(event, context):
    try:
        records = scan_records(attributes=_PROJECTION)
    except Exception:
        # Don't leak table names, ARNs or client internals to an open endpoint.
        return error_response(502, "Could not list passages")

    passages = [_summary(r) for r in records if r.get("id")]
    passages.sort(key=lambda p: (p["band"] or "", p["title"].lower()))
    return json_response(200, {"passages": passages})
