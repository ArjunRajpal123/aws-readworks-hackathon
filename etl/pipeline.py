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
Otherwise qa.status is 'fallback_sentence' and granularity is 'sentence'.
The full contract (S3 layout, DynamoDB item, API) is docs/baseref.txt.
"""

from __future__ import annotations

import gzip
import io
import json
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Protocol

import audio as audio_mod
import mp3duration
from ssml import build_ssml, load_inline_lexicon, parse_overrides
from tokenizer import tokenize
from voices import tracks_for

# 0.3.1: qa.status fallback is "fallback_sentence" (schema v3); API runs this pipeline.
# 0.4.0: passages over the sync cap are synthesized in parts and joined (long text).
PIPELINE_VERSION = "sa-pipeline-0.4.0"
# Polly Neural list price per 1M characters; speech marks are billed separately
# at the same rate, so billed_chars already counts both requests.
NEURAL_USD_PER_MCHAR = 16.0
# Synchronous SynthesizeSpeech also caps total input (SSML tags included).
SYNC_TOTAL_CHAR_CAP = 6000
# Long passages are split at paragraph (else sentence) boundaries into parts
# that stay under both sync caps with some headroom, synthesized one by one,
# and joined: MP3 frames concatenated, each part's word times offset by the
# audio before it. Short passages (one part) take exactly the original path.
PART_SPOKEN_CAP = 2800
PART_TOTAL_CAP = 5600


@dataclass
class PassageInput:
    id: str
    lang: str
    title: str
    text: str
    # Optional per-word pronunciation fixes: {"<tokenIndex>": {"w": "amazon:VB"}}.
    pronunciation: dict | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "PassageInput":
        """Build from an input JSON / API body: {id, lang, title, text, pronunciation?}.

        Shared by run_local.py, run_aws.py and the API Lambda so every entry
        point reads passages the same way.
        """
        return cls(
            id=data["id"],
            lang=data.get("lang", "en"),
            title=data.get("title", data["id"]),
            text=data["text"],
            pronunciation=data.get("pronunciation"),
        )


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


def _sub_tokenized(tk, lo: int, hi: int):
    """Tokens lo..hi-1 as their own Tokenized (indices from 0), for one part."""
    toks = [replace(t, i=t.i - lo) for t in tk.tokens[lo:hi]]
    paras = sorted({0} | {s - lo for s in tk.paragraph_starts if lo <= s < hi})
    sents = sorted({0} | {s - lo for s in tk.sentence_starts if lo <= s < hi})
    return replace(tk, tokens=toks, paragraph_starts=paras, sentence_starts=sents)


def _sub_passage(passage: PassageInput, lo: int, hi: int) -> PassageInput:
    pron = {str(int(k) - lo): v for k, v in (passage.pronunciation or {}).items()
            if lo <= int(k) < hi}
    return replace(passage, pronunciation=pron or None)


def _part_input(passage, tk, voice, lo, hi) -> dict:
    return _polly_input(_sub_tokenized(tk, lo, hi), voice, _sub_passage(passage, lo, hi))


def _fits(pin: dict, spoken_cap: int, total_cap: int) -> bool:
    return pin["spoken_chars"] <= spoken_cap and len(pin["text"]) <= total_cap


def plan_parts(passage: PassageInput, tk, voice) -> list[tuple[int, int]]:
    """Token ranges [lo, hi) to synthesize separately; [(0, n)] if it fits in one call."""
    n = tk.token_count
    if _fits(_polly_input(tk, voice, passage), audio_mod.SYNC_CHAR_CAP, SYNC_TOTAL_CHAR_CAP):
        return [(0, n)]

    def fits(lo, hi):
        return _fits(_part_input(passage, tk, voice, lo, hi), PART_SPOKEN_CAP, PART_TOTAL_CAP)

    # Units: whole paragraphs, or a paragraph's sentences if it is too long.
    bounds = sorted({0, *tk.paragraph_starts}) + [n]
    units: list[tuple[int, int]] = []
    for a, b in zip(bounds, bounds[1:]):
        if fits(a, b):
            units.append((a, b))
            continue
        ss = sorted({a} | {s for s in tk.sentence_starts if a < s < b}) + [b]
        for c, d in zip(ss, ss[1:]):
            if not fits(c, d):
                raise ValueError(f"passage {passage.id}: one sentence (tokens {c}-{d - 1}) "
                                 f"is over the {PART_SPOKEN_CAP}-char part cap")
            units.append((c, d))
    # Greedily pack units into as few parts as fit.
    parts = [units[0]]
    for a, b in units[1:]:
        if fits(parts[-1][0], b):
            parts[-1] = (parts[-1][0], b)
        else:
            parts.append((a, b))
    return parts


def _synthesize_parts(passage, tk, voice, polly_client, parts) -> dict:
    """Synthesize each part and join audio, marks and timing into one track."""
    mp3s, mark_lines, inputs = [], [], []
    start, end, low_conf, merged = [], [], [], []
    billed = ssml_sentences = word_marks = 0
    offset = 0
    ok = True
    for k, (lo, hi) in enumerate(parts):
        sub_tk = _sub_tokenized(tk, lo, hi)
        pin = _polly_input(sub_tk, voice, _sub_passage(passage, lo, hi))
        synth = audio_mod.synthesize_track(polly_client, pin["text"], voice, pin["type"])
        dur = mp3duration.duration_ms(synth.mp3)
        t = audio_mod.build_timing(
            tokens=sub_tk.tokens, polly_text=pin["text"], marks_jsonlines=synth.marks_jsonlines,
            duration_ms=dur, voice_id=voice.voice_id, engine=voice.engine,
            text_hash=tk.text_hash, token_spans=pin["spans"],
        )
        ok = ok and t.qa_status == audio_mod.QA_PASSED
        start += [x + offset for x in t.start]
        end += [x + offset for x in t.end]
        low_conf += [i + lo for i in t.low_conf]
        merged += [i + lo for i in pin["merged"]]
        ssml_sentences += pin["ssml_sentences"] or 0
        billed += synth.billed_chars
        # Marks keep their byte offsets into this part's input; times are made absolute.
        for line in synth.marks_jsonlines.splitlines():
            if line.strip():
                m = json.loads(line)
                m["time"] = int(m["time"]) + offset
                m["part"] = k
                word_marks += m.get("type") == "word"
                mark_lines.append(json.dumps(m, ensure_ascii=False))
        mp3s.append(synth.mp3)
        inputs.append(f"<!-- part {k}: tokens {lo}-{hi - 1} -->\n{pin['text']}")
        offset += dur

    mp3 = b"".join(mp3s)
    duration = mp3duration.duration_ms(mp3)
    end[-1] = duration
    status = audio_mod._qa(start, duration, word_marks, len(start), low_conf)
    timing = audio_mod.Timing(
        start=start, end=end, n=len(start), voice_id=voice.voice_id, engine=voice.engine,
        duration_ms=duration, qa_status=status if ok else audio_mod.QA_FALLBACK,
        low_conf=low_conf,
    )
    ssml = voice.ssml
    pin = {"text": "\n".join(inputs), "type": "ssml" if ssml else "text",
           "ssml_sentences": ssml_sentences if ssml else None, "merged": merged}
    synth = audio_mod.Synthesis(mp3=mp3, marks_jsonlines="\n".join(mark_lines) + "\n",
                                billed_chars=billed)
    return {"pin": pin, "synth": synth, "timing": timing}


def _make_track(passage: PassageInput, tk, voice, polly_client) -> tuple[dict, dict, dict]:
    """Synthesize one voice track. Returns (track record, files to write, summary)."""
    parts = plan_parts(passage, tk, voice)
    if len(parts) == 1:
        pin = _polly_input(tk, voice, passage)
        synth = audio_mod.synthesize_track(polly_client, pin["text"], voice, pin["type"])
        duration = mp3duration.duration_ms(synth.mp3)
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
    else:
        joined = _synthesize_parts(passage, tk, voice, polly_client, parts)
        pin, synth, timing = joined["pin"], joined["synth"], joined["timing"]
    all_marks = [json.loads(l) for l in synth.marks_jsonlines.splitlines() if l.strip()]
    word_marks = sum(1 for m in all_marks if m.get("type") == "word")
    polly_sentences = sum(1 for m in all_marks if m.get("type") == "sentence")

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
            "parts": len(parts),
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
        "parts": len(parts),
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
