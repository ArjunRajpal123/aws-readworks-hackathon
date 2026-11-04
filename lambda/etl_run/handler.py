"""ETL in the cloud: run the Sound Along pipeline for a passage uploaded to S3.

Trigger: EventBridge "Object Created" for s3://<media bucket>/incoming/*.json
(see infra/cdk/lib/etl-stack.ts). The object is the same JSON the local
runners read from etl/inputs/: {id, lang, title, text, pronunciation?}.

On success the pipeline writes sa/product/<id>.soundAlong.json, every voice
track's MP3 + timing under sa/audio/<id>/, and the DynamoDB record, exactly
like etl/run_aws.py. The input is then moved to processed/<file>.

Bad input (not JSON, missing fields, over the size cap) is moved to
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
# Longer than Polly's 3,000-char synchronous cap: the pipeline (0.4.0) splits
# long text into parts and joins them. The bound keeps one run well inside the
# 5-minute timeout (20,000 chars is about 8 parts x 2 voices x 2 calls); the
# longest ReadWorks passage in the UI is about 7,900 chars.
MAX_TEXT_CHARS = 20000


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
    if len(data["text"]) > MAX_TEXT_CHARS:
        raise BadInput(f"text is {len(data['text'])} chars; the cloud ETL "
                       f"accepts up to {MAX_TEXT_CHARS}")
    return PassageInput.from_dict(data)


def _move(bucket: str, key: str, dest_prefix: str) -> str:
    s3 = s3_client()
    dest = dest_prefix + key[len(INCOMING):]
    s3.copy_object(Bucket=bucket, Key=dest, CopySource={"Bucket": bucket, "Key": key})
    s3.delete_object(Bucket=bucket, Key=key)
    return dest


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
        dest = _move(bucket, key, "failed/")
        s3.put_object(Bucket=bucket, Key=dest[:-5] + ".error.json",
                      Body=json.dumps({"source": key, "error": str(exc)}).encode(),
                      ContentType="application/json")
        log.warning("rejected %s: %s", key, exc)
        return {"status": "rejected", "key": key, "error": str(exc)}

    pipeline_runtime.ensure_lexicons_once()
    result = run(passage, pipeline_runtime.polly(), pipeline_runtime.storage())
    dest = _move(bucket, key, "processed/")
    summary = {"status": "done", "id": passage.id, "input": dest,
               "tracks": [t["track"] for t in result["tracks"]],
               "billedChars": result["billedChars"], "estCostUsd": result["estCostUsd"]}
    log.info(json.dumps(summary))
    return summary
