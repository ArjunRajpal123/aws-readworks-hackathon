"""Gets audio + word timing from the deployed /api/v1/text-to-speech Lambda
API instead of calling Amazon Polly directly.

The API's response is a flat [{id, s, e, block}, ...] word list (no byte
offsets), but audio.build_timing() expects Polly-shaped marks (byte offsets
into the exact text sent). We reconstruct those offsets the same way
audio._byte_spans() does -- walk the text locating each returned word in
order -- so synthesize() below is a drop-in replacement for audio.synthesize()
and pipeline.run() needs no further changes for this source.
"""

from __future__ import annotations

import json
import urllib.request

TIMEOUT_SECONDS = 60


def _post_json(url: str, body: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=TIMEOUT_SECONDS) as resp:
        return resp.read()


def _marks_jsonlines(text: str, timestamp: list[dict]) -> str:
    data = text.encode("utf-8")
    cursor = 0
    lines = []
    for word in timestamp:
        needle = word["block"].encode("utf-8")
        pos = data.find(needle, cursor)
        if pos < 0:
            # Shouldn't happen since `text` is exactly what we sent the API,
            # but stay defensive like audio._byte_spans() does.
            pos = cursor
        cursor = pos + len(needle)
        mark = {
            "time": word["s"],
            "type": "word",
            "start": pos,
            "end": cursor,
            "value": word["block"],
        }
        lines.append(json.dumps(mark))
    return "\n".join(lines)


def synthesize(api_url: str, language_code: str, text: str, voice_id: str, engine: str):
    """(text, voice_id, engine) -> (mp3_bytes, marks_jsonlines).

    Bind api_url/language_code with functools.partial before passing this
    to pipeline.run() -- see run_api.py.
    """
    body = {
        "text": text,
        "voiceId": voice_id,
        "engine": engine,
        "languageCode": language_code,
    }
    record = _post_json(f"{api_url.rstrip('/')}/api/v1/text-to-speech", body)
    mp3_bytes = _get_bytes(record["audio"])
    marks_jsonlines = _marks_jsonlines(text, record["timestamp"])
    return mp3_bytes, marks_jsonlines
