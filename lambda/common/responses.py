"""Shared helpers for building API Gateway Lambda-proxy responses."""
import json
from decimal import Decimal


def _default(obj):
    # DynamoDB returns numbers as Decimal, which json can't serialize.
    # Emit ints where whole, floats otherwise.
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError(f"Object of type {obj.__class__.__name__} is not JSON serializable")


def json_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, default=_default),
    }


def error_response(status_code, message):
    return json_response(status_code, {"error": message})
