"""Reads/writes a text-to-speech record in the shared DynamoDB reference
table (infra/cdk's StorageStack), partition key `id`.
"""
import os
<<<<<<< HEAD
from decimal import Decimal
=======
>>>>>>> main

import boto3

_table = boto3.resource("dynamodb").Table(os.environ.get("TTS_REFERENCE_TABLE"))


<<<<<<< HEAD
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


=======
>>>>>>> main
def save_record(record):
    _table.put_item(Item=record)


def load_record(record_id):
    response = _table.get_item(Key={"id": record_id})
<<<<<<< HEAD
    item = response.get("Item")
    return _from_dynamo(item) if item is not None else None
=======
    return response.get("Item")
>>>>>>> main
