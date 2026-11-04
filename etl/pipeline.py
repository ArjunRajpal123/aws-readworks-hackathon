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
from voices import tracks_for

PIPELINE_VERSION = "sa-pipeline-0.3.0"
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


def _polly_input(tk, voice, passage: PassageInput) -> dict:
    """What Polly is sent for one voice: SSML (default) or the original plain text."""
    if voice.ssml:
        # SSML: <p>/<s> pauses from the tokenizer's structure, pace, DRC,
        # lexicon fallback and per-word overrides. Token byte spans are
        # recorded while building, because Polly's offsets count the tags.
        overrides = parse_overrides(passage.pronunciation, tk.token_count)
        inline = (load_inline_lexicon(voice.lexicon_path)
                  if voice.inline_lexicon and voice.lexicon_path else None)
        doc = build_ssml(tk, voice, overrides=overrides, inline_lexicon=inline)
        return {"text": doc.text, "type": "ssml", "spans": doc.token_spans,
                "spoken_chars": doc.plain_chars, "ssml_sentences": doc.sentence_count,
                "merged": list(doc.merged_breaks)}
    # Original path: detokenized text = tokens joined by spaces, so the
    # byte offsets Polly returns line up with our token byte spans.
    text = " ".join(t.text for t in tk.tokens)
    return {"text": text, "type": "text", "spans": None, "spoken_chars": len(text),
            "ssml_sentences": None, "merged": []}


def _gzip_json(obj: dict) -> bytes:
    gz = io.BytesIO()
    with gzip.GzipFile(fileobj=gz, mode="wb") as f:
        f.write(json.dumps(obj, separators=(",", ":")).encode("utf-8"))
    return gz.getvalue()


def _make_track(passage: PassageInput, tk, voice, polly_client) -> tuple[dict, dict, dict]:
    """Synthesize one voice track. Returns (track record, files to write, summary)."""
    pin = _polly_input(tk, voice, passage)
    if pin["spoken_chars"] > audio_mod.SYNC_CHAR_CAP or len(pin["text"]) > SYNC_TOTAL_CHAR_CAP:
        raise ValueError(
            f"passage {passage.id} is over Polly's {audio_mod.SYNC_CHAR_CAP}-char "
            "sync cap; async synthesis path not implemented yet"
        )

    synth = audio_mod.synthesize_track(polly_client, pin["text"], voice, pin["type"])
    duration = mp3duration.duration_ms(synth.mp3)
    all_marks = [json.loads(l) for l in synth.marks_jsonlines.splitlines() if l.strip()]
    word_marks = sum(1 for m in all_marks if m.get("type") == "word")
    polly_sentences = sum(1 for m in all_marks if m.get("type") == "sentence")

    timing = audio_mod.build_timing(
        tokens=tk.tokens,
        polly_text=pin["text"],
        marks_jsonlines=synth.marks_jsonlines,
        duration_ms=duration,
        voice_id=voice.voice_id,
        engine=voice.engine,
        text_hash=tk.text_hash,
        token_spans=pin["spans"],
    )

    tid = voice.track_id
    ext = "ssml" if pin["type"] == "ssml" else "txt"
    audio_key = f"audio/{passage.id}/{tid}.mp3"
    timing_key = f"audio/{passage.id}/{tid}.timing.json.gz"
    # Review/debug artifacts (not read by the player).
    marks_key = f"audio/{passage.id}/{tid}.marks.jsonl"
    input_key = f"audio/{passage.id}/{tid}.input.{ext}"

    # start/end/n/textHash are what the player reads; v/trackId/durationMs
    # complete the team schema's timingFile shape (the player ignores them).
    timing_json = {
        "v": 1,
        "trackId": tid,
        "start": timing.start,
        "end": timing.end,
        "n": timing.n,
        "durationMs": timing.duration_ms,
        "textHash": tk.text_hash,
    }
    cost = round(synth.billed_chars * NEURAL_USD_PER_MCHAR / 1_000_000, 5)

    track = {
        "id": tid,
        "kind": "tts",
        "default": voice.default,
        "engine": voice.engine,
        "voiceId": voice.voice_id,
        "voiceGender": voice.gender,
        "lexicon": voice.lexicon_name if voice.lexicon_name else None,
        "audioKey": audio_key,
        "timingKey": timing_key,
        "timingSource": "polly-speech-marks",
        "granularity": "word" if timing.qa_status == "passed" else "sentence",
        "configVersion": voice.config_version,
        "settings": {
            "textType": pin["type"],
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
            "ssmlSentences": pin["ssml_sentences"],
            "mergedSentenceBreaks": pin["merged"],
            "billedChars": synth.billed_chars,
            "estCostUsd": cost,
        },
    }
    files = {
        audio_key: (synth.mp3, "audio/mpeg", None),
        timing_key: (_gzip_json(timing_json), "application/json", "gzip"),
        marks_key: (synth.marks_jsonlines.encode("utf-8"), "application/x-ndjson", None),
        input_key: (pin["text"].encode("utf-8"),
                    "application/ssml+xml" if ext == "ssml" else "text/plain", None),
    }
    summary = {
        "track": tid,
        "voiceId": voice.voice_id,
        "voiceGender": voice.gender,
        "qa": timing.qa_status,
        "lowConfidence": len(timing.low_conf),
        "durationMs": timing.duration_ms,
        "pollySentences": polly_sentences,
        "ssmlSentences": pin["ssml_sentences"],
        "billedChars": synth.billed_chars,
        "estCostUsd": cost,
        "audioKey": audio_key,
        "timingKey": timing_key,
    }
    return track, files, summary


def run(passage: PassageInput, polly_client, storage: Storage,
        track_ids: list[str] | None = None) -> dict:
    """Run P1+P3 for one passage and write the player-facing output.

    One audio track per voice in voices.json for the passage's language
    (e.g. tts-1 female = default, tts-2 male). tracks[0] is the default
    track, which is what the player plays. `track_ids` limits which extra
    tracks are generated (the default track is always included).
    """
    lang2 = (passage.lang or "en").lower()[:2]

    # --- P1: tokenize ------------------------------------------------------
    tk = tokenize(passage.text, lang=lang2)

    # --- P3: audio + timing, one track per configured voice -----------------
    voices = [v for v in tracks_for(lang2)
              if v.default or track_ids is None or v.track_id in track_ids]
    built = [_make_track(passage, tk, v, polly_client) for v in voices]
    tracks = [b[0] for b in built]
    summaries = [b[2] for b in built]
    default = summaries[0]

    # --- product record ----------------------------------------------------
    now = datetime.now(timezone.utc).isoformat()
    billed = sum(s["billedChars"] for s in summaries)
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
        "tracks": tracks,
        "generation": {
            "pipelineVersion": PIPELINE_VERSION,
            "runAt": now,
            "inputHash": tk.text_hash,
            "configVersion": tracks[0]["configVersion"],
            "billedChars": billed,
            "estCostUsd": round(billed * NEURAL_USD_PER_MCHAR / 1_000_000, 5),
        },
    }

    # --- write: every track's files first, the product record last ---------
    for _, files, _ in built:
        for key, (data, ctype, enc) in files.items():
            storage.put_bytes(key, data, ctype, content_encoding=enc)
    storage.put_bytes(
        f"product/{passage.id}.soundAlong.json",
        json.dumps(product, ensure_ascii=False, indent=2).encode("utf-8"),
        "application/json",
    )
    storage.put_record(passage.id, product)

    # Top-level fields describe the default track (unchanged shape), plus
    # one summary per track.
    keep = ("durationMs", "qa", "lowConfidence", "pollySentences",
            "ssmlSentences", "voiceId", "audioKey", "timingKey")
    return {
        "id": passage.id,
        "tokenCount": tk.token_count,
        "sentences": len(tk.sentence_starts),
        **{k: default[k] for k in keep},
        "billedChars": billed,
        "estCostUsd": product["generation"]["estCostUsd"],
        "tracks": summaries,
    }
