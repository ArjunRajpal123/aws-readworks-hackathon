"""Persists generated text and audio to the shared media bucket.

The bucket is provisioned by infra/cdk's StorageStack (shared with the rest
of the ETL pipeline) and is KMS-encrypted. Text/audio blobs land under the
`text/`/`audio/` prefixes, matching the passage data contract (see
docs/baseref.txt).
"""
import os

import boto3
from botocore.client import Config

# us-west-2 defaults the S3 client to SigV2 for presigned URLs, but objects
# under SSE-KMS (this bucket) require SigV4 -- without this, GET requests
# against the presigned text/audio URLs fail with "Requests specifying
# Server Side Encryption with AWS KMS managed keys require AWS Signature
# Version 4."
#
# region_name is explicit because without it, generate_presigned_url can
# fall back to the legacy global `s3.amazonaws.com` host, which replies
# with a 307 TemporaryRedirect for any bucket outside us-east-1.
_s3 = boto3.client(
    "s3",
    region_name=os.environ.get("AWS_REGION"),
    config=Config(signature_version="s3v4"),
)

BUCKET = os.environ.get("TTS_MEDIA_BUCKET")
TEXT_PREFIX = os.environ.get("TTS_TEXT_S3_KEY_PREFIX", "text")
AUDIO_PREFIX = os.environ.get("TTS_AUDIO_S3_KEY_PREFIX", "audio")
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
    return key, _presigned_url(key)


def save_audio(record_id, audio_bytes):
    key = f"{AUDIO_PREFIX}/{record_id}.mp3"
    _put(key, audio_bytes, "audio/mpeg")
    return key, _presigned_url(key)
