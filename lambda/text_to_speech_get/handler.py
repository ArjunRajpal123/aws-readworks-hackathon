"""GET /api/v1/text-to-speech?id=...

Fetches a Sound Along product record by passage id straight from
sa/product/<id>.soundAlong.json in the shared media bucket (written by the
pipeline: the API's POST or the ETL's run_aws.py) and adds fresh presigned
URLs for each track's audio and timing file under `urls`. Reading the S3
file itself, rather than the DynamoDB mirror, keeps the response
byte-identical to the stored product record.
"""

from common.responses import error_response, json_response
from common.s3_store import get_product, with_urls


def handler(event, context):
    params = event.get("queryStringParameters") or {}
    record_id = params.get("id")
    if not record_id:
        return error_response(400, "Query parameter 'id' is required")

    record = get_product(record_id)
    if record is None:
        return error_response(404, f"No record found for id '{record_id}'")

    return json_response(200, with_urls(record))
