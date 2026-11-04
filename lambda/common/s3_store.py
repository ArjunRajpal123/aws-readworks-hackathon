"""Read access to the pipeline's files in the shared media bucket.

Writes are done by the Sound Along pipeline itself (etl/pipeline.py via
etl/storage.py's AwsStorage), under the `sa/` prefix. This module turns the
keys stored on a product record (`tracks[].audioKey` / `timingKey`, which are
relative to `sa/`) into presigned GET URLs for API callers, and reads the
product record itself straight from its S3 object so callers get exactly
what the pipeline wrote (see get_product).

The bucket is provisioned by infra/cdk's StorageStack and is KMS-encrypted.
"""

import json
import os

import boto3
from botocore.client import Config

# us-west-2 defaults the S3 client to SigV2 for presigned URLs, but objects
# under SSE-KMS (this bucket) require SigV4 -- without this, GET requests
# against the presigned URLs fail with "Requests specifying Server Side
# Encryption with AWS KMS managed keys require AWS Signature Version 4."
#
# region_name is explicit because without it, generate_presigned_url can
# fall back to the legacy global `s3.amazonaws.com` host, which replies
# with a 307 TemporaryRedirect for any bucket outside us-east-1.
_s3 = None

BUCKET = os.environ.get("TTS_MEDIA_BUCKET")
KEY_PREFIX = os.environ.get("TTS_S3_KEY_PREFIX", "sa/")
URL_TTL_SECONDS = int(os.environ.get("TTS_URL_TTL_SECONDS", "3600"))


def s3_client():
    global _s3
    if _s3 is None:
        region = os.environ.get("AWS_REGION", "us-west-2")
        # region_name alone still yields `<bucket>.s3.amazonaws.com` URLs;
        # the regional endpoint gives `<bucket>.s3.<region>.amazonaws.com`.
        _s3 = boto3.client(
            "s3",
            region_name=region,
            endpoint_url=f"https://s3.{region}.amazonaws.com",
            config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
        )
    return _s3


def get_product(record_id):
    """The product record straight from sa/product/<id>.soundAlong.json.

    Reading the file the pipeline wrote (rather than the DynamoDB mirror)
    keeps the response byte-identical to the S3 record: DynamoDB drops null
    fields and stores floats as Decimal (see docs/baseref.txt). None if the
    id has no product record.
    """
    client = s3_client()
    try:
        body = client.get_object(
            Bucket=BUCKET, Key=f"{KEY_PREFIX}product/{record_id}.soundAlong.json"
        )["Body"].read()
    except client.exceptions.NoSuchKey:
        return None
    return json.loads(body)


def presigned_url(key):
    """Presigned GET URL for a product-record key (relative to KEY_PREFIX)."""
    return s3_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": KEY_PREFIX + key},
        ExpiresIn=URL_TTL_SECONDS,
    )


def with_urls(product):
    """Copy of the product record plus `urls`: {trackId: {audio, timing}}.

    `urls` is response-only (never stored): the URLs expire after
    TTS_URL_TTL_SECONDS. Records without `tracks` are returned unchanged.
    """
    tracks = product.get("tracks") or []
    if not tracks:
        return product
    out = dict(product)
    out["urls"] = {
        t["id"]: {
            "audio": presigned_url(t["audioKey"]),
            "timing": presigned_url(t["timingKey"]),
        }
        for t in tracks
    }
    return out
