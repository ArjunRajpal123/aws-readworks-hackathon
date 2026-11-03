"""Shared helpers for building API Gateway Lambda-proxy responses."""
import json


def json_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def error_response(status_code, message):
    return json_response(status_code, {"error": message})
