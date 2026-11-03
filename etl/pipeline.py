"""Pipeline orchestrator: P1 (tokenize) + P3 (audio + timing) -> stored output.

Produces exactly what the player (frontend/src/engine.js, loadAudio) reads:

  product record  sa/product/<id>.soundAlong.json
      { id, lang, title, textHash, tokenizerVersion, tokenCount,
        contentTokenized, structure{paragraphStarts, sentenceStarts},
        tracks: [ { id, kind, engine, voiceId, audioKey, timingKey,
                    timingSource, granularity, qa{status,...} } ],
        generation{...} }

  audio           sa/audio/<id>/tts-1.mp3
  timing (gzip)   sa/audio/<id>/tts-1.timing.json.gz
      { start:[ms...], end:[ms...], n, textHash }

The player ignores the timing file unless tracks[0].qa.status == 'passed' and
timing.textHash == product.textHash, so both are written consistently.
"""

from __future__ import annotations

import gzip
import io
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol

import audio as audio_mod
import mp3duration
from tokenizer import tokenize

PIPELINE_VERSION = "sa-pipeline-0.1.0"


@dataclass
class PassageInput:
    id: str
    lang: str
    title: str
    text: str


class Storage(Protocol):
    """Where the pipeline writes output (local dir or AWS S3/DynamoDB)."""

    def put_bytes(self, key: str, data: bytes, content_type: str,
                  content_encoding: str | None = None) -> None: ...

    def put_record(self, record_id: str, record: dict) -> None: ...


def run(passage: PassageInput, polly_client, storage: Storage) -> dict:
    """Run P1+P3 for one passage and write the player-facing output."""
    lang2 = (passage.lang or "en").lower()[:2]

    # --- P1: tokenize ------------------------------------------------------
    tk = tokenize(passage.text, lang=lang2)

    # detokenized text we send to Polly = the token stream joined by spaces,
    # so the byte offsets Polly returns line up with our token byte spans.
    polly_text = " ".join(t.text for t in tk.tokens)

    # --- P3: audio + timing ------------------------------------------------
    voice = audio_mod.VOICE_BY_LANG.get(lang2, audio_mod.VOICE_BY_LANG["en"])
    if len(polly_text.encode("utf-8")) > audio_mod.SYNC_CHAR_CAP:
        raise ValueError(
            f"passage {passage.id} is over Polly's {audio_mod.SYNC_CHAR_CAP}-char "
            "sync cap; async synthesis path not implemented yet"
        )

    mp3_bytes, marks = audio_mod.synthesize(
        polly_client, polly_text, voice["voiceId"], voice["engine"]
    )
    duration = mp3duration.duration_ms(mp3_bytes)

    timing = audio_mod.build_timing(
        tokens=tk.tokens,
        polly_text=polly_text,
        marks_jsonlines=marks,
        duration_ms=duration,
        voice_id=voice["voiceId"],
        engine=voice["engine"],
        text_hash=tk.text_hash,
    )

    # --- keys --------------------------------------------------------------
    audio_key = f"audio/{passage.id}/tts-1.mp3"
    timing_key = f"audio/{passage.id}/tts-1.timing.json.gz"

    # --- timing blob (gzipped JSON) ---------------------------------------
    timing_json = {
        "start": timing.start,
        "end": timing.end,
        "n": timing.n,
        "textHash": tk.text_hash,
    }
    gz = io.BytesIO()
    with gzip.GzipFile(fileobj=gz, mode="wb") as f:
        f.write(json.dumps(timing_json, separators=(",", ":")).encode("utf-8"))
    timing_gz = gz.getvalue()

    # --- product record ----------------------------------------------------
    now = datetime.now(timezone.utc).isoformat()
    product = {
        "schemaVersion": 3,
        "id": passage.id,
        "lang": lang2,
        "title": passage.title,
        "textHash": tk.text_hash,
        "tokenizerVersion": tk.tokenizer_version,
        "tokenCount": tk.token_count,
        "contentTokenized": tk.content_tokenized,
        "structure": {
            "paragraphStarts": tk.paragraph_starts,
            "sentenceStarts": tk.sentence_starts,
        },
        "tracks": [
            {
                "id": "tts-1",
                "kind": "tts",
                "engine": voice["engine"],
                "voiceId": voice["voiceId"],
                "lexicon": None,
                "audioKey": audio_key,
                "timingKey": timing_key,
                "timingSource": "polly-speech-marks",
                "granularity": "word" if timing.qa_status == "passed" else "sentence",
                "qa": {
                    "status": timing.qa_status,
                    "tokens": timing.n,
                    "marks": timing.n,
                    "lowConfidence": timing.low_conf,
                    "durationMs": timing.duration_ms,
                },
            }
        ],
        "generation": {
            "pipelineVersion": PIPELINE_VERSION,
            "runAt": now,
            "inputHash": tk.text_hash,
        },
    }

    # --- write -------------------------------------------------------------
    storage.put_bytes(audio_key, mp3_bytes, "audio/mpeg")
    storage.put_bytes(
        timing_key, timing_gz, "application/json", content_encoding="gzip"
    )
    storage.put_bytes(
        f"product/{passage.id}.soundAlong.json",
        json.dumps(product, ensure_ascii=False, indent=2).encode("utf-8"),
        "application/json",
    )
    storage.put_record(passage.id, product)

    return {
        "id": passage.id,
        "tokenCount": tk.token_count,
        "durationMs": timing.duration_ms,
        "qa": timing.qa_status,
        "lowConfidence": len(timing.low_conf),
        "audioKey": audio_key,
        "timingKey": timing_key,
    }
