"""Submissions API: queue passages for the cloud ETL and report their status.

POST /api/v1/submissions
    Body: {"items": [{"text", "title"?, "lang"? | "languageCode"?, "id"?,
                      "pronunciation"?}, ...], "overwrite"?: bool}
    Each item is validated and written to s3://<media>/incoming/<id>.json,
    which triggers the etl-run Lambda (EventBridge). Returns 202 right away,
    so there is no text-length limit tied to the ~29 s API Gateway timeout:
    the ETL has 5 minutes per passage and splits long text into parts.
    An item whose id already has a product record is refused (409 for that
    item) unless "overwrite": true, so an open endpoint can't silently
    replace catalog audio. Response:
      {"submissionId", "items": [{"id", "status": "queued"|"rejected", "error"?}]}

GET /api/v1/submissions/{submissionId}
    Per item: "queued" (input still in incoming/: waiting or running),
    "done" (moved to processed/ after this submission), "failed" (moved to
    failed/, with the ETL's error) or "unknown". Done items include
    `productKey` for the player (sa/product/<id>.soundAlong.json).

The submission manifest is stored at submissions/<submissionId>.json in the
media bucket; nothing else is needed (no table).
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone

from botocore.exceptions import BotoCoreError, ClientError

from common.rbac import require_groups
from common.responses import error_response, json_response
from common.s3_store import KEY_PREFIX, s3_client

log = logging.getLogger()
log.setLevel(logging.INFO)

BUCKET = os.environ.get("TTS_MEDIA_BUCKET", "")
MAX_ITEMS = 200
MAX_TITLE_CHARS = 200
SUPPORTED_LANGS = ("en", "es")
_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_SUB_RE = re.compile(r"^[0-9a-f]{32}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _lang2(item):
    raw = item.get("lang") or item.get("languageCode") or "en-US"
    if not isinstance(raw, str):
        return None
    lang = raw.strip().lower()[:2]
    return lang if lang in SUPPORTED_LANGS else None


def _exists(key: str) -> bool:
    try:
        s3_client().head_object(Bucket=BUCKET, Key=key)
        return True
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def _validate(item, index):
    """Return (passage dict, None) or (None, error message)."""
    if not isinstance(item, dict):
        return None, f"items[{index}] must be an object"
    text = item.get("text")
    if not isinstance(text, str) or not text.strip():
        return None, "'text' is required"
    lang = _lang2(item)
    if lang is None:
        return None, "'lang' must be en or es (or languageCode en-US / es-US)"
    pid = item.get("id")
    if pid is None:
        pid = "sub-" + uuid.uuid4().hex[:12]
    elif not isinstance(pid, str) or not _ID_RE.match(pid):
        return None, "'id' must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}"
    title = item.get("title", pid)
    if not isinstance(title, str) or len(title) > MAX_TITLE_CHARS:
        return None, f"'title' must be a string of at most {MAX_TITLE_CHARS} characters"
    passage = {"id": pid, "lang": lang, "title": title.strip() or pid, "text": text}
    if item.get("pronunciation") is not None:
        if not isinstance(item["pronunciation"], dict):
            return None, "'pronunciation' must be an object"
        passage["pronunciation"] = item["pronunciation"]
    return passage, None


def _post(event):
    try:
        raw = event.get("body") or ""
        if event.get("isBase64Encoded"):
            import base64
            raw = base64.b64decode(raw).decode("utf-8")
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return error_response(400, "Body must be JSON")
    if not isinstance(body, dict) or not isinstance(body.get("items"), list) or not body["items"]:
        return error_response(400, "'items' must be a non-empty list")
    if len(body["items"]) > MAX_ITEMS:
        return error_response(400, f"At most {MAX_ITEMS} items per submission")
    overwrite = body.get("overwrite") is True

    sid = uuid.uuid4().hex
    at = _now()
    results, seen = [], set()
    for i, item in enumerate(body["items"]):
        passage, err = _validate(item, i)
        if err:
            results.append({"index": i, "id": (item or {}).get("id") if isinstance(item, dict) else None,
                            "status": "rejected", "error": err})
            continue
        pid = passage["id"]
        if pid in seen:
            results.append({"index": i, "id": pid, "status": "rejected", "error": "duplicate id in this submission"})
            continue
        seen.add(pid)
        if not overwrite and _exists(f"{KEY_PREFIX}product/{pid}.soundAlong.json"):
            results.append({"index": i, "id": pid, "status": "rejected", "code": 409,
                            "error": "id already has audio; send \"overwrite\": true to regenerate"})
            continue
        s3_client().put_object(Bucket=BUCKET, Key=f"incoming/{pid}.json",
                               Body=json.dumps(passage, ensure_ascii=False).encode("utf-8"),
                               ContentType="application/json")
        results.append({"index": i, "id": pid, "status": "queued", "chars": len(passage["text"])})

    manifest = {"submissionId": sid, "submittedAt": at,
                "items": [{"id": r["id"], "status": r["status"], **({"error": r["error"]} if "error" in r else {})}
                          for r in results]}
    s3_client().put_object(Bucket=BUCKET, Key=f"submissions/{sid}.json",
                           Body=json.dumps(manifest).encode("utf-8"), ContentType="application/json")
    queued = sum(r["status"] == "queued" for r in results)
    log.info(json.dumps({"submission": sid, "queued": queued, "rejected": len(results) - queued}))
    status = 202 if queued else 400
    return json_response(status, {"submissionId": sid, "submittedAt": at, "queued": queued, "items": results})


def _modified_after(key: str, at: str) -> bool | None:
    """True/False if the object exists (modified at/after `at`?), None if missing."""
    try:
        head = s3_client().head_object(Bucket=BUCKET, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return None
        raise
    return head["LastModified"] >= datetime.fromisoformat(at)


def _item_status(pid: str, at: str) -> dict:
    if _exists(f"incoming/{pid}.json"):
        return {"id": pid, "status": "queued"}
    if _modified_after(f"processed/{pid}.json", at):
        return {"id": pid, "status": "done", "productKey": f"{KEY_PREFIX}product/{pid}.soundAlong.json"}
    if _modified_after(f"failed/{pid}.json", at):
        out = {"id": pid, "status": "failed"}
        try:
            err = s3_client().get_object(Bucket=BUCKET, Key=f"failed/{pid}.error.json")["Body"].read()
            out["error"] = json.loads(err).get("error")
        except (ClientError, ValueError):
            pass
        return out
    return {"id": pid, "status": "unknown"}


def _get(event):
    sid = ((event.get("pathParameters") or {}).get("submissionId") or "").strip()
    if not _SUB_RE.match(sid):
        return error_response(400, "Invalid submission id")
    try:
        manifest = json.loads(s3_client().get_object(Bucket=BUCKET, Key=f"submissions/{sid}.json")["Body"].read())
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
            return error_response(404, f"No submission '{sid}'")
        raise
    at = manifest["submittedAt"]
    items = [_item_status(it["id"], at) if it["status"] == "queued" else it for it in manifest["items"]]
    counts = {}
    for it in items:
        counts[it["status"]] = counts.get(it["status"], 0) + 1
    return json_response(200, {"submissionId": sid, "submittedAt": at, "counts": counts,
                               "complete": not counts.get("queued"), "items": items})


def handler(event, _context):
    method = (event.get("requestContext", {}).get("http", {}).get("method") or "").upper()
    try:
        if method == "POST":
            denied = require_groups(event)
            if denied:
                return error_response(403, denied)
            return _post(event)
        if method == "GET":
            return _get(event)
        return error_response(405, "Method not allowed")
    except (ClientError, BotoCoreError) as exc:
        log.exception("storage error")
        return error_response(502, f"Storage error: {type(exc).__name__}")
