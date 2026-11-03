"""GET /api/v1/text-to-speech?id=...

Fetches a previously generated text-to-speech record (text url, audio url,
word timing) by id.
"""
from botocore.exceptions import ClientError

from common.responses import error_response, json_response
from common.s3_store import load_record


def handler(event, context):
    params = event.get("queryStringParameters") or {}
    record_id = params.get("id")
    if not record_id:
        return error_response(400, "Query parameter 'id' is required")

    try:
        record = load_record(record_id)
    except ClientError:
        return error_response(404, f"No record found for id '{record_id}'")

    return json_response(200, record)
