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
