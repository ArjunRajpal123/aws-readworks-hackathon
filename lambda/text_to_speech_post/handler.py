"""POST /api/v1/text-to-speech

Text-only ingest (audio skipped — no Amazon Polly in this account yet).

Parses the given text into word-level tokens, stores the text blob in the
shared media bucket, writes the record to the shared reference table, and
returns the record. When Polly becomes available, re-introduce audio
synthesis + real word timing (see common/timing.py).
"""
import json
import uuid

from common.reference_store import save_record
from common.responses import error_response, json_response
from common.s3_store import save_text
from common.timing import build_timestamps_from_text

DEFAULT_LANGUAGE_CODE = "en-US"
MAX_TEXT_CHARS = 3000


def handler(event, context):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return error_response(400, "Request body must be valid JSON")

    text = body.get("text")
    if not text or not isinstance(text, str) or not text.strip():
        return error_response(400, "'text' is required and must be a non-empty string")
    if len(text) > MAX_TEXT_CHARS:
        return error_response(400, f"'text' must be {MAX_TEXT_CHARS} characters or fewer")

    language_code = body.get("languageCode") or DEFAULT_LANGUAGE_CODE

    record_id = uuid.uuid4().hex
    text_path, text_url = save_text(record_id, text)

    record = {
        "id": record_id,
        "lang": language_code.split("-")[0].upper(),
        "text_path": text_path,
        "text": text_url,
        # Audio is skipped for now; kept null so the shape stays stable.
        "audio_path": None,
        "audio": None,
        # Tokens with null start/end (no alignment without audio).
        "timestamp": build_timestamps_from_text(text),
    }
    save_record(record)

    return json_response(201, record)
