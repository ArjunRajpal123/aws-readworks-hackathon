"""Persists text, audio and the combined record to S3, and loads records back."""
import json
import os

import boto3

_s3 = boto3.client("s3")

BUCKET = os.environ.get("TTS_OUTPUT_BUCKET")
TEXT_PREFIX = os.environ.get("TTS_TEXT_S3_KEY_PREFIX", "texts")
AUDIO_PREFIX = os.environ.get("TTS_AUDIO_S3_KEY_PREFIX", "audio")
RECORD_PREFIX = os.environ.get("TTS_RECORD_S3_KEY_PREFIX", "records")
URL_TTL_SECONDS = int(os.environ.get("TTS_URL_TTL_SECONDS", "3600"))


def _put(key, body, content_type):
    _s3.put_object(Bucket=BUCKET, Key=key, Body=body, ContentType=content_type)


def _presigned_url(key):
    return _s3.generate_presigned_url(
        "get_object", Params={"Bucket": BUCKET, "Key": key}, ExpiresIn=URL_TTL_SECONDS
    )


def save_text(record_id, text):
    key = f"{TEXT_PREFIX}/{record_id}.txt"
    _put(key, text.encode("utf-8"), "text/plain")
    return _presigned_url(key)


def save_audio(record_id, audio_bytes):
    key = f"{AUDIO_PREFIX}/{record_id}.mp3"
    _put(key, audio_bytes, "audio/mpeg")
    return _presigned_url(key)


def save_record(record):
    key = f"{RECORD_PREFIX}/{record['id']}.json"
    _put(key, json.dumps(record).encode("utf-8"), "application/json")


def load_record(record_id):
    key = f"{RECORD_PREFIX}/{record_id}.json"
    obj = _s3.get_object(Bucket=BUCKET, Key=key)
    return json.loads(obj["Body"].read())
