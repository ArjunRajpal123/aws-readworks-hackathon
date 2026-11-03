"""POST /api/v1/text-to-speech

Synthesizes audio and word-level timing for the given text via Amazon
Polly, stores text/audio in the shared media bucket, writes the record to
the shared reference table, and returns the record.
"""
import json
import uuid

from common.polly import (
    DEFAULT_LANGUAGE_CODE,
    MAX_TEXT_CHARS,
    synthesize_audio,
    synthesize_word_marks,
)
from common.reference_store import save_record
from common.responses import error_response, json_response
from common.s3_store import save_audio, save_text
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
    language_code = body.get("languageCode") or DEFAULT_LANGUAGE_CODE
    engine = body.get("engine")

    try:
        word_marks = synthesize_word_marks(text, voice_id, language_code, engine)
        audio_bytes = synthesize_audio(text, voice_id, language_code, engine)
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as a 502
        return error_response(502, f"Failed to synthesize speech: {exc}")

    record_id = uuid.uuid4().hex
    text_path, text_url = save_text(record_id, text)
    audio_path, audio_url = save_audio(record_id, audio_bytes)
    record = {
        "id": record_id,
        "lang": language_code.split("-")[0].upper(),
        "text_path": text_path,
        "text": text_url,
        "audio_path": audio_path,
        "audio": audio_url,
        "timestamp": build_timestamps(word_marks),
    }
    save_record(record)

    return json_response(201, record)
