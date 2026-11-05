"""POST /api/v1/text-to-speech

Runs the Sound Along pipeline (etl/pipeline.py) on the given text: shared
tokenizer, SSML with the configured Polly Neural voices and lexicons
(etl/voices.json), word timing aligned to tokens, and QA. Writes the same
files and product record the ETL writes (S3 `sa/...`, DynamoDB item keyed
by passage id), so the Vue player and the GET endpoint read API-generated
passages exactly like catalog passages.

Request body:
    text          required, non-empty, <= 3000 characters
    languageCode  optional, e.g. "en-US" / "es-US" (default "en-US"); `lang` ("en"/"es") also accepted
    id            optional passage id (starts with a letter or digit, then
                  [A-Za-z0-9._-], max 64 chars); default: random hex.
                  An id that already exists is REJECTED with 409 and nothing
                  is written, so this open endpoint can never overwrite a
                  catalog or earlier passage. To regenerate a passage, use the
                  ETL runner (etl/run_aws.py), which uses your own AWS credentials.
    title         optional, at most 200 characters, default = id
    voiceId       optional; a voice configured for the language in voices.json
                  (e.g. "Stephen"). Generates that track in addition to the default one.
    allVoices     optional bool; generate every configured voice track
    pronunciation optional per-token overrides, same format as ETL inputs

Voice, engine and naturalness settings come from etl/voices.json; they are
never chosen per request. The legacy `engine` field is ignored.

Response 201: the product record plus `urls`: {trackId: {audio, timing}}
(presigned, expire after TTS_URL_TTL_SECONDS).
"""

import base64
import binascii
import json
import re
import uuid

from botocore.exceptions import BotoCoreError, ClientError

from common import pipeline_runtime, reference_store
from common.responses import error_response, json_response
from common.s3_store import with_urls
from pipeline import PassageInput, run
from ssml import build_ssml, parse_overrides
from tokenizer import tokenize
from voices import tracks_for

MAX_TEXT_CHARS = 3000  # Polly synchronous SynthesizeSpeech cap (spoken characters)
MAX_TITLE_CHARS = 200
SUPPORTED_LANGS = ("en", "es")
# Must start with a letter or digit: rejects ".", "..", ".hidden", "-x" etc.
_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def _lang2(body):
    raw = body.get("lang") or body.get("languageCode") or "en-US"
    if not isinstance(raw, str):
        return None
    lang = raw.strip().lower()[:2]
    return lang if lang in SUPPORTED_LANGS else None


def _track_ids(body, lang):
    """Extra tracks to generate (the default track is always generated)."""
    if body.get("allVoices") is True:
        return None  # pipeline: None = every configured track
    voice_id = body.get("voiceId")
    if not voice_id:
        return []
    for v in tracks_for(lang):
        if v.voice_id.lower() == str(voice_id).lower():
            return [v.track_id]
    raise LookupError(voice_id)


def _check_pronunciation(pronunciation, text, lang):
    """Dry-run the pipeline's own override parsing and SSML build.

    Malformed overrides (wrong types, missing keys, bad indexes) otherwise blow
    up inside the pipeline as a 500, or after Polly has already been billed.
    Returns an error message, or None when the overrides are usable.
    """
    try:
        tk = tokenize(text, lang)
        overrides = parse_overrides(pronunciation, tk.token_count)
        build_ssml(tk, tracks_for(lang)[0], overrides=overrides)
    except ValueError as exc:  # the parser's own, safe-to-show messages
        return f"'pronunciation' is invalid: {str(exc)[:200]}"
    except (TypeError, AttributeError, KeyError):
        return ("'pronunciation' is malformed; expected "
                '{"<tokenIndex>": {"sub": "...", "w": "...", "lang": "...", '
                '"sayAs": "...", "phoneme": {"ph": "..."}}}')
    return None


def _read_body(event):
    """Raw request body as text.

    HTTP API base64-encodes the body (isBase64Encoded) when the request's
    Content-Type isn't a text type, e.g. curl -d without a header sends
    application/x-www-form-urlencoded.
    """
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw, validate=True).decode("utf-8")
    return raw or "{}"


def handler(event, context):
    try:
        body = json.loads(_read_body(event))
    except (json.JSONDecodeError, binascii.Error, UnicodeDecodeError):
        return error_response(400, "Request body must be valid JSON")
    if not isinstance(body, dict):
        return error_response(400, "Request body must be a JSON object")

    text = body.get("text")
    if not text or not isinstance(text, str) or not text.strip():
        return error_response(400, "'text' is required and must be a non-empty string")
    if len(text) > MAX_TEXT_CHARS:
        return error_response(400, f"'text' must be {MAX_TEXT_CHARS} characters or fewer")

    lang = _lang2(body)
    if lang is None:
        return error_response(400, f"'languageCode' must be one of: {', '.join(SUPPORTED_LANGS)}")

    client_id = body.get("id")
    record_id = client_id or uuid.uuid4().hex
    if not isinstance(record_id, str) or not _ID_RE.match(record_id):
        return error_response(
            400, "'id' must match [A-Za-z0-9][A-Za-z0-9._-]{0,63} (start with a letter or digit)")

    title = body.get("title") or record_id
    if not isinstance(title, str):
        return error_response(400, "'title' must be a string")
    if len(title) > MAX_TITLE_CHARS:
        return error_response(400, f"'title' must be {MAX_TITLE_CHARS} characters or fewer")

    pronunciation = body.get("pronunciation")
    if pronunciation is not None:
        if not isinstance(pronunciation, dict):
            return error_response(400, "'pronunciation' must be an object")
        problem = _check_pronunciation(pronunciation, text, lang)
        if problem:
            return error_response(400, problem)

    try:
        track_ids = _track_ids(body, lang)
    except LookupError:
        voices = ", ".join(v.voice_id for v in tracks_for(lang))
        return error_response(400, f"'voiceId' must be one of the {lang} voices: {voices}")

    # Never overwrite: a client-chosen id that already exists is refused before
    # any Polly call or write. (Generated ids are random, so skip the lookup.)
    # Best-effort: two simultaneous first-time requests for the same new id can
    # both pass this check; the window is a single request.
    if client_id:
        try:
            already = reference_store.load_record(record_id) is not None
        except (ClientError, BotoCoreError):
            return error_response(502, "Could not check whether that id is already in use")
        if already:
            return error_response(
                409, f"A passage with id '{record_id}' already exists; choose a different id")

    vocab_cards = body.get("vocabularyCards")
    if vocab_cards is not None and not isinstance(vocab_cards, list):
        return error_response(400, "'vocabularyCards' must be an array")

    review = body.get("review")
    if review is not None and not isinstance(review, dict):
        return error_response(400, "'review' must be an object")

    passage = PassageInput.from_dict(
        {"id": record_id, "lang": lang, "title": title, "text": text,
         "pronunciation": pronunciation, "vocabularyCards": vocab_cards,
         "review": review}
    )

    storage = _RecordingStorage(pipeline_runtime.storage())
    try:
        pipeline_runtime.ensure_lexicons_once()
        run(passage, pipeline_runtime.polly(), storage, track_ids=track_ids)
    except ValueError as exc:  # input rejected by the pipeline (e.g. over Polly's sync cap)
        return error_response(400, str(exc))
    except (ClientError, BotoCoreError) as exc:
        return error_response(502, f"Failed to synthesize speech: {exc}")

    # Return what was stored (the product record) plus fresh presigned URLs.
    return json_response(201, with_urls(storage.record))


class _RecordingStorage:
    """Pass-through Storage that keeps the product record the pipeline wrote."""

    def __init__(self, inner):
        self.inner = inner
        self.record = None

    def put_bytes(self, key, data, content_type, content_encoding=None):
        self.inner.put_bytes(key, data, content_type, content_encoding=content_encoding)

    def put_record(self, record_id, record):
        self.inner.put_record(record_id, record)
        self.record = record
