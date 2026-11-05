"""POST /api/v1/passages/approve  { "id": "<passage-id>" }

Marks an AI-generated (machine-translated) passage as human-reviewed:
flips its review.reviewStatus from "draft" to "reviewed". The player uses
this to drop the "AI draft — pending review" badge.

Updates both stores so every reader sees it: the S3 product JSON (what GET
/api/v1/text-to-speech returns) and the DynamoDB reference item (what the
list endpoint scans). Idempotent: approving an already-reviewed passage is
fine.
"""

import base64
import json
import logging

from botocore.exceptions import BotoCoreError, ClientError

from common import reference_store
from common.responses import error_response, json_response
from common.s3_store import get_product, put_product

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def _read_body(event):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    return json.loads(raw) if raw else {}


def handler(event, context):
    try:
        data = _read_body(event)
    except (ValueError, UnicodeDecodeError):
        return error_response(400, "Body must be valid JSON")

    record_id = (data.get("id") or "").strip()
    if not record_id:
        return error_response(400, "'id' is required")

    # S3 product record is the source of truth for GET; update it first.
    product = get_product(record_id)
    if product is None:
        return error_response(404, f"No passage found for id '{record_id}'")

    review = dict(product.get("review") or {})
    if not review:
        # Nothing to approve: only AI/draft passages carry a review block.
        return error_response(409, "This passage has no review state to approve")

    review["reviewStatus"] = "reviewed"
    product["review"] = review

    try:
        put_product(record_id, product)
        reference_store.set_review_status(record_id, "reviewed")
    except (ClientError, BotoCoreError):
        logger.warning("approve: failed to update stores for %s", record_id)
        return error_response(502, "Could not update the passage")

    logger.info("approve: %s -> reviewed", record_id)
    return json_response(200, {"id": record_id, "reviewStatus": "reviewed"})
