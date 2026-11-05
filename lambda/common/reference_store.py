"""Reads Sound Along product records from the shared DynamoDB reference
table (infra/cdk's StorageStack), partition key `id`.

Records are written by the pipeline (etl/storage.py AwsStorage.put_record),
so the item is the product record: {id, lang, title, textHash,
contentTokenized, structure, tracks[], generation, ...}.
"""

import os
from decimal import Decimal

import boto3

_table = None


def _get_table():
    global _table
    if _table is None:
        _table = boto3.resource("dynamodb").Table(os.environ.get("TTS_REFERENCE_TABLE"))
    return _table


def _from_dynamo(value):
    # boto3's DynamoDB resource deserializes every Number as Decimal, even
    # plain ints -- json.dumps can't handle that, so convert back on read.
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, list):
        return [_from_dynamo(v) for v in value]
    if isinstance(value, dict):
        return {k: _from_dynamo(v) for k, v in value.items()}
    return value


def load_record(record_id):
    response = _get_table().get_item(Key={"id": record_id})
    item = response.get("Item")
    return _from_dynamo(item) if item is not None else None


def scan_records(attributes=None):
    """Every product record in the reference table.

    `attributes` (optional) is a list of top-level attribute names to project,
    keeping the scan cheap when the caller only needs a few fields (the list
    endpoint needs just id/lang/title/band). Follows pagination so all pages
    are returned. Records are small and the table is bounded by the passage
    catalog, so a full scan is acceptable here.
    """
    table = _get_table()
    kwargs = {}
    if attributes:
        # Build a projection that is safe even if a name is a DynamoDB reserved
        # word (e.g. "lang" is reserved): alias every attribute with #n0, #n1...
        names = {f"#n{i}": name for i, name in enumerate(attributes)}
        kwargs["ProjectionExpression"] = ", ".join(names)
        kwargs["ExpressionAttributeNames"] = names

    items = []
    while True:
        response = table.scan(**kwargs)
        items.extend(response.get("Items", []))
        start_key = response.get("LastEvaluatedKey")
        if not start_key:
            break
        kwargs["ExclusiveStartKey"] = start_key
    return [_from_dynamo(item) for item in items]


def set_review_status(record_id, status):
    """Set review.reviewStatus on a record (used by the approve endpoint).
    Returns the updated record, or None if the id doesn't exist."""
    table = _get_table()
    try:
        response = table.update_item(
            Key={"id": record_id},
            UpdateExpression="SET #r.#s = :status",
            ConditionExpression="attribute_exists(id) AND attribute_exists(#r)",
            ExpressionAttributeNames={"#r": "review", "#s": "reviewStatus"},
            ExpressionAttributeValues={":status": status},
            ReturnValues="ALL_NEW",
        )
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        return None
    item = response.get("Attributes")
    return _from_dynamo(item) if item is not None else None
