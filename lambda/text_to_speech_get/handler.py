"""GET /api/v1/text-to-speech?id=...

Fetches a previously generated text-to-speech record (text url, audio url,
word timing) by id from the shared reference table. text/audio URLs are
presigned fresh on every call (see common/s3_store.presigned_url) rather
than read from storage, so they're always valid for a full
TTS_URL_TTL_SECONDS from the moment of this request.
"""
from common.reference_store import load_record
from common.responses import error_response, json_response
from common.s3_store import presigned_url


def handler(event, context):
    params = event.get("queryStringParameters") or {}
    record_id = params.get("id")
    if not record_id:
        return error_response(400, "Query parameter 'id' is required")

    record = load_record(record_id)
    if record is None:
        return error_response(404, f"No record found for id '{record_id}'")

    response = {
        **record,
        "text": presigned_url(record["text_path"]) if record.get("text_path") else None,
        "audio": presigned_url(record["audio_path"]) if record.get("audio_path") else None,
    }
    return json_response(200, response)
