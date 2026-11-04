"""GET /api/v1/text-to-speech?id=...

Fetches a Sound Along product record by passage id from the shared
reference table (written by the pipeline: the API's POST or the ETL's
run_aws.py) and adds fresh presigned URLs for each track's audio and
timing file under `urls`.
"""

from common.reference_store import load_record
from common.responses import error_response, json_response
from common.s3_store import with_urls


def handler(event, context):
    params = event.get("queryStringParameters") or {}
    record_id = params.get("id")
    if not record_id:
        return error_response(400, "Query parameter 'id' is required")

    record = load_record(record_id)
    if record is None:
        return error_response(404, f"No record found for id '{record_id}'")

    return json_response(200, with_urls(record))
