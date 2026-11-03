"""Reads/writes a text-to-speech record in the shared DynamoDB reference
table (infra/cdk's StorageStack), partition key `id`.
"""
import os

import boto3

_table = boto3.resource("dynamodb").Table(os.environ.get("TTS_REFERENCE_TABLE"))


def save_record(record):
    _table.put_item(Item=record)


def load_record(record_id):
    response = _table.get_item(Key={"id": record_id})
    return response.get("Item")
