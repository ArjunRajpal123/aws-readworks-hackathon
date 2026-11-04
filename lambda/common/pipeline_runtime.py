"""Wires the Sound Along pipeline (etl/) to AWS inside Lambda.

The ETL modules (pipeline, audio, ssml, tokenizer, voices, storage,
mp3duration, voices.json, lexicons/) are copied into the function bundle
root by infra/cdk's ApiStack, so they import exactly as they do in etl/.
For local runs, scripts/invoke_local.py puts ../etl on sys.path.

Clients are created lazily and cached per container. Lexicons are uploaded
once per container (PutLexicon is idempotent) because every track sends
LexiconNames and Polly fails with LexiconNotFoundException without them.
"""

import os

import boto3

from audio import ensure_lexicons
from storage import AwsStorage
from voices import load_voices

_cache = {}


def polly():
    if "polly" not in _cache:
        _cache["polly"] = boto3.client("polly")
    return _cache["polly"]


def storage():
    if "storage" not in _cache:
        from common.s3_store import KEY_PREFIX, s3_client

        _cache["storage"] = AwsStorage(
            bucket=os.environ["TTS_MEDIA_BUCKET"],
            table=os.environ["TTS_REFERENCE_TABLE"],
            s3_client=s3_client(),
            dynamodb_resource=boto3.resource("dynamodb"),
            prefix=KEY_PREFIX,
        )
    return _cache["storage"]


def ensure_lexicons_once():
    if not _cache.get("lexicons"):
        ensure_lexicons(polly(), load_voices())
        _cache["lexicons"] = True
