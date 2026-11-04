"""ETL in the cloud: run the Sound Along pipeline for a passage uploaded to S3.

Trigger: EventBridge "Object Created" for s3://<media bucket>/incoming/*.json
(see infra/cdk/lib/etl-stack.ts). The object is the same JSON the local
runners read from etl/inputs/: {id, lang, title, text, pronunciation?}.

On success the pipeline writes sa/product/<id>.soundAlong.json, every voice
track's MP3 + timing under sa/audio/<id>/, and the DynamoDB record, exactly
like etl/run_aws.py. The input is then moved to processed/<file>.

Bad input (not JSON, missing fields, or text the pipeline refuses, e.g. one
sentence longer than Polly's per-request cap) is moved to
failed/<file> with an .error.json next to it, and is not retried.
Anything else (Polly throttling, S3/DynamoDB errors) is raised, so
EventBridge's async Lambda retries run and, after that, the event lands in
the stack's dead-letter queue. Unlike POST /api/v1/text-to-speech, this
regenerates an existing id: uploading is how the content team re-runs one.
"""
import json
import logging
import os
import urllib.parse

from common import pipeline_runtime
from common.s3_store import s3_client
from pipeline import PassageInput, run

log = logging.getLogger()
log.setLevel(logging.INFO)

INCOMING = "incoming/"


class BadInput(ValueError):
    pass


def _parse(raw: bytes) -> PassageInput:
    try:
        data = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BadInput(f"not valid JSON: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("id"), str) \
            or not isinstance(data.get("text"), str) or not data["text"].strip():
        raise BadInput("expected an object with string 'id' and non-empty 'text'")
    if (data.get("lang") or "en")[:2].lower() not in ("en", "es"):
        raise BadInput(f"unsupported lang {data.get('lang')!r}")
    return PassageInput.from_dict(data)


def _move(bucket: str, key: str, dest_prefix: str) -> str:
    s3 = s3_client()
    dest = dest_prefix + key[len(INCOMING):]
    s3.copy_object(Bucket=bucket, Key=dest, CopySource={"Bucket": bucket, "Key": key})
    s3.delete_object(Bucket=bucket, Key=key)
    return dest


def _reject(bucket: str, key: str, exc: Exception) -> dict:
    dest = _move(bucket, key, "failed/")
    s3_client().put_object(Bucket=bucket, Key=dest[:-5] + ".error.json",
                           Body=json.dumps({"source": key, "error": str(exc)}).encode(),
                           ContentType="application/json")
    log.warning("rejected %s: %s", key, exc)
    return {"status": "rejected", "key": key, "error": str(exc)}


def handler(event, _context):
    detail = event.get("detail", {})
    bucket = detail["bucket"]["name"]
    key = urllib.parse.unquote_plus(detail["object"]["key"])
    if not key.startswith(INCOMING) or not key.endswith(".json"):
        log.info("ignoring %s", key)
        return {"status": "ignored", "key": key}

    s3 = s3_client()
    try:
        raw = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    except s3.exceptions.NoSuchKey:
        log.info("%s already handled", key)  # duplicate event delivery
        return {"status": "gone", "key": key}

    try:
        passage = _parse(raw)
    except BadInput as exc:
        return _reject(bucket, key, exc)

    pipeline_runtime.ensure_lexicons_once()
    try:
        # Text over Polly's sync cap is split into parts by the pipeline.
        result = run(passage, pipeline_runtime.polly(), pipeline_runtime.storage())
    except ValueError as exc:  # the pipeline refused the input; retrying won't help
        return _reject(bucket, key, exc)
    dest = _move(bucket, key, "processed/")
    summary = {"status": "done", "id": passage.id, "input": dest,
               "tracks": [t["track"] for t in result["tracks"]],
               "billedChars": result["billedChars"], "estCostUsd": result["estCostUsd"]}
    log.info(json.dumps(summary))
    return summary
