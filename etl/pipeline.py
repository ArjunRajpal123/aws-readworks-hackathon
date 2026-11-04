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
from ssml import build_ssml, load_inline_lexicon, parse_overrides
from tokenizer import tokenize
from voices import voice_for

PIPELINE_VERSION = "sa-pipeline-0.2.0"
# Polly Neural list price per 1M characters; speech marks are billed separately
# at the same rate, so billed_chars already counts both requests.
NEURAL_USD_PER_MCHAR = 16.0
# Synchronous SynthesizeSpeech also caps total input (SSML tags included).
SYNC_TOTAL_CHAR_CAP = 6000


@dataclass
class PassageInput:
    id: str
    lang: str
    title: str
    text: str
    # Optional per-word pronunciation fixes: {"<tokenIndex>": {"w": "amazon:VB"}}.
    pronunciation: dict | None = None


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

    # --- P3: audio + timing ------------------------------------------------
    # Voice + naturalness settings per language come from voices.json.
    voice = voice_for(lang2)
    if voice.ssml:
        # SSML: <p>/<s> pauses from the tokenizer's structure, pace, DRC,
        # lexicon fallback and per-word overrides. Token byte spans are
        # recorded while building, because Polly's offsets count the tags.
        overrides = parse_overrides(passage.pronunciation, tk.token_count)
        inline = (load_inline_lexicon(voice.lexicon_path)
                  if voice.inline_lexicon and voice.lexicon_path else None)
        doc = build_ssml(tk, voice, overrides=overrides, inline_lexicon=inline)
        polly_text, text_type = doc.text, "ssml"
        token_spans, spoken_chars = doc.token_spans, doc.plain_chars
        ssml_sentences, merged_breaks = doc.sentence_count, list(doc.merged_breaks)
    else:
        # Original path: detokenized text = tokens joined by spaces, so the
        # byte offsets Polly returns line up with our token byte spans.
        polly_text = " ".join(t.text for t in tk.tokens)
        text_type, token_spans, spoken_chars = "text", None, len(polly_text)
        ssml_sentences, merged_breaks = None, []

    if spoken_chars > audio_mod.SYNC_CHAR_CAP or len(polly_text) > SYNC_TOTAL_CHAR_CAP:
        raise ValueError(
            f"passage {passage.id} is over Polly's {audio_mod.SYNC_CHAR_CAP}-char "
            "sync cap; async synthesis path not implemented yet"
        )

    synth = audio_mod.synthesize_track(polly_client, polly_text, voice, text_type)
    mp3_bytes = synth.mp3
    duration = mp3duration.duration_ms(mp3_bytes)
    all_marks = [json.loads(l) for l in synth.marks_jsonlines.splitlines() if l.strip()]
    word_marks = sum(1 for m in all_marks if m.get("type") == "word")
    polly_sentences = sum(1 for m in all_marks if m.get("type") == "sentence")

    timing = audio_mod.build_timing(
        tokens=tk.tokens,
        polly_text=polly_text,
        marks_jsonlines=synth.marks_jsonlines,
        duration_ms=duration,
        voice_id=voice.voice_id,
        engine=voice.engine,
        text_hash=tk.text_hash,
        token_spans=token_spans,
    )

    # --- keys --------------------------------------------------------------
    audio_key = f"audio/{passage.id}/tts-1.mp3"
    timing_key = f"audio/{passage.id}/tts-1.timing.json.gz"
    # Review/debug artifacts (not read by the player).
    marks_key = f"audio/{passage.id}/tts-1.marks.jsonl"
    input_key = f"audio/{passage.id}/tts-1.input.{'ssml' if text_type == 'ssml' else 'txt'}"

    # --- timing blob (gzipped JSON) ---------------------------------------
    # start/end/n/textHash are what the player reads; v/trackId/durationMs
    # complete the team schema's timingFile shape (the player ignores them).
    timing_json = {
        "v": 1,
        "trackId": "tts-1",
        "start": timing.start,
        "end": timing.end,
        "n": timing.n,
        "durationMs": timing.duration_ms,
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
                "engine": voice.engine,
                "voiceId": voice.voice_id,
                "lexicon": voice.lexicon_name if voice.lexicon_name else None,
                "audioKey": audio_key,
                "timingKey": timing_key,
                "timingSource": "polly-speech-marks",
                "granularity": "word" if timing.qa_status == "passed" else "sentence",
                "configVersion": voice.config_version,
                "settings": {
                    "textType": text_type,
                    "rate": voice.rate,
                    "drc": voice.drc,
                    "paragraphBreakMs": voice.paragraph_break_ms,
                    "sampleRate": voice.sample_rate,
                    "lexiconMode": ("inline" if voice.inline_lexicon
                                    else "polly" if voice.lexicon_names else "none"),
                    "pronunciationOverrides": len(passage.pronunciation or {}),
                },
                "qa": {
                    "status": timing.qa_status,
                    "tokens": timing.n,
                    "marks": word_marks,
                    "lowConfidence": timing.low_conf,
                    "durationMs": timing.duration_ms,
                    "sentences": len(tk.sentence_starts),
                    "pollySentences": polly_sentences,
                    # Sentences Polly was given (<s>): tokenizer sentences minus
                    # false breaks after "Mr."/"U.S." etc. Should equal pollySentences.
                    "ssmlSentences": ssml_sentences,
                    "mergedSentenceBreaks": merged_breaks,
                },
            }
        ],
        "generation": {
            "pipelineVersion": PIPELINE_VERSION,
            "runAt": now,
            "inputHash": tk.text_hash,
            "configVersion": voice.config_version,
            "billedChars": synth.billed_chars,
            "estCostUsd": round(synth.billed_chars * NEURAL_USD_PER_MCHAR / 1_000_000, 5),
        },
    }

    # --- write -------------------------------------------------------------
    storage.put_bytes(audio_key, mp3_bytes, "audio/mpeg")
    storage.put_bytes(
        timing_key, timing_gz, "application/json", content_encoding="gzip"
    )
    storage.put_bytes(marks_key, synth.marks_jsonlines.encode("utf-8"),
                      "application/x-ndjson")
    storage.put_bytes(input_key, polly_text.encode("utf-8"),
                      "application/ssml+xml" if text_type == "ssml" else "text/plain")
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
        "sentences": len(tk.sentence_starts),
        "pollySentences": polly_sentences,
        "ssmlSentences": ssml_sentences,
        "billedChars": synth.billed_chars,
        "estCostUsd": product["generation"]["estCostUsd"],
        "voiceId": voice.voice_id,
        "audioKey": audio_key,
        "timingKey": timing_key,
    }
