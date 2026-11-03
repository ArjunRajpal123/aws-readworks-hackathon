"""POST /api/v1/text-to-speech

Synthesizes audio and word-level timing for the given text via Amazon
Polly, stores text/audio/record in S3, and returns the full record.
"""
import json
import uuid

from common.polly import MAX_TEXT_CHARS, synthesize_audio, synthesize_word_marks
from common.responses import error_response, json_response
from common.s3_store import save_audio, save_record, save_text
from common.timing import build_timestamps


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

    voice_id = body.get("voiceId")
    language_code = body.get("languageCode")
    engine = body.get("engine")

    try:
        word_marks = synthesize_word_marks(text, voice_id, language_code, engine)
        audio_bytes = synthesize_audio(text, voice_id, language_code, engine)
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as a 502
        return error_response(502, f"Failed to synthesize speech: {exc}")

    record_id = uuid.uuid4().hex
    record = {
        "id": record_id,
        "text": save_text(record_id, text),
        "audio": save_audio(record_id, audio_bytes),
        "timestamp": build_timestamps(word_marks),
    }
    save_record(record)

    return json_response(201, record)
