"""P3 — Audio and word timing via Amazon Polly.

Two Polly calls with identical Text/VoiceId/Engine:
  1. OutputFormat=mp3   -> the audio
  2. OutputFormat=json, SpeechMarkTypes=['word'] -> word speech marks

Polly speech-mark offsets are **UTF-8 byte offsets** into the text (confirmed
by a spike against Joanna/neural), NOT character offsets, and punctuation is
not its own mark. We map each mark to a token by matching the mark's byte span
to the token's byte span in the exact text we sent to Polly.

Output timing is parallel arrays in milliseconds:
  start[i], end[i] for token i, plus n (token count) and the textHash.
  end[i] = start[i+1]; the last end is estimated from the audio duration.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import List, Optional

from tokenizer import Token
from voices import VoiceConfig, load_voices

# Voice per language now comes from voices.json (Stage 2 config): Ruth (en) /
# Lupe (es), Neural. Same shape as before for existing callers.
VOICE_BY_LANG = {
    lang: {"voiceId": v.voice_id, "engine": v.engine}
    for lang, v in load_voices().items()
}

# Polly synchronous synthesize_speech caps at 3000 billed characters.
SYNC_CHAR_CAP = 3000


@dataclass
class Timing:
    start: List[int]  # ms, per token
    end: List[int]  # ms, per token
    n: int  # token count
    voice_id: str
    engine: str
    duration_ms: int
    # QA: every token mapped, times non-decreasing, last start < duration.
    qa_status: str  # "passed" | "sentence"
    low_conf: List[int]  # token indices with no direct mark (interpolated)


def _byte_spans(tokens: List[Token], text: str) -> List[tuple[int, int]]:
    """Byte-offset span of each token within `text` (the exact Polly input).

    We walk the text locating each token's text in order, so repeated words
    map to the correct occurrence.
    """
    data = text.encode("utf-8")
    spans: List[tuple[int, int]] = []
    cursor = 0  # byte cursor into data
    for t in tokens:
        needle = t.text.encode("utf-8")
        pos = data.find(needle, cursor)
        if pos < 0:
            # Shouldn't happen when text is the detokenized token stream, but
            # be defensive: leave a zero-width span to be interpolated later.
            spans.append((cursor, cursor))
            continue
        spans.append((pos, pos + len(needle)))
        cursor = pos + len(needle)
    return spans


def build_timing(
    tokens: List[Token],
    polly_text: str,
    marks_jsonlines: str,
    duration_ms: int,
    voice_id: str,
    engine: str,
    text_hash: str,
    token_spans: Optional[List[tuple[int, int]]] = None,
) -> Timing:
    """Map Polly word marks (byte offsets) onto tokens -> start[]/end[] ms.

    `token_spans` (optional): each token's UTF-8 byte span in `polly_text`,
    as recorded by ssml.build_ssml. Needed for SSML input, where searching
    for the raw token text could hit a tag or miss an XML-escaped token.
    When omitted, spans are found by searching the plain text (original path).
    """
    marks = [
        json.loads(line)
        for line in marks_jsonlines.splitlines()
        if line.strip()
    ]
    # Only word marks map to tokens; sentence/ssml marks may share offsets.
    marks = [m for m in marks if m.get("type", "word") == "word"]
    # Each mark: {time, type:'word', start, end, value} where start/end are
    # UTF-8 byte offsets into polly_text.
    if token_spans is None:
        token_spans = _byte_spans(tokens, polly_text)

    n = len(tokens)
    start: List[Optional[int]] = [None] * n
    low_conf: List[int] = []

    # Assign each mark to the token whose byte span contains the mark's start.
    mi = 0
    for i, (b0, b1) in enumerate(token_spans):
        # advance marks until one starts at/after this token's byte start
        while mi < len(marks) and marks[mi]["start"] < b0:
            mi += 1
        if mi < len(marks) and b0 <= marks[mi]["start"] < max(b1, b0 + 1):
            start[i] = int(marks[mi]["time"])
            mi += 1
        else:
            low_conf.append(i)

    # Interpolate any token that didn't get a direct mark, so every token has
    # a time (times must only increase).
    _fill_missing(start, duration_ms)

    start_ms = [int(s) for s in start]  # type: ignore[arg-type]
    end_ms = start_ms[1:] + [duration_ms]
    # Guard monotonicity.
    for i in range(1, n):
        if end_ms[i - 1] < start_ms[i - 1]:
            end_ms[i - 1] = start_ms[i - 1]

    qa_status = _qa(start_ms, duration_ms, len(marks), n, low_conf)

    return Timing(
        start=start_ms,
        end=end_ms,
        n=n,
        voice_id=voice_id,
        engine=engine,
        duration_ms=duration_ms,
        qa_status=qa_status,
        low_conf=low_conf,
    )


def _fill_missing(start: List[Optional[int]], duration_ms: int) -> None:
    n = len(start)
    if n == 0:
        return
    if start[0] is None:
        start[0] = 0
    # Forward-fill gaps by linear interpolation between known anchors.
    i = 0
    while i < n:
        if start[i] is not None:
            i += 1
            continue
        # find previous known
        prev = i - 1
        prev_val = start[prev]  # known (start[0] forced)
        # find next known
        j = i
        while j < n and start[j] is None:
            j += 1
        next_val = start[j] if j < n else duration_ms
        gap = j - prev  # number of steps
        step = (next_val - prev_val) / gap if gap else 0
        for k in range(i, j):
            start[k] = int(prev_val + step * (k - prev))
        i = j


def _qa(
    start_ms: List[int],
    duration_ms: int,
    n_marks: int,
    n_tokens: int,
    low_conf: List[int],
) -> str:
    """Word-level QA. Falls back to 'sentence' on failure (never blocks)."""
    if not start_ms:
        return "sentence"
    non_decreasing = all(
        start_ms[i] <= start_ms[i + 1] for i in range(len(start_ms) - 1)
    )
    last_within = start_ms[-1] <= duration_ms
    # Too many tokens without a direct mark => not trustworthy at word level.
    coverage_ok = len(low_conf) <= max(1, n_tokens // 10)
    if non_decreasing and last_within and coverage_ok:
        return "passed"
    return "sentence"


def synthesize(polly_client, text: str, voice_id: str, engine: str):
    """Return (mp3_bytes, marks_jsonlines) from two Polly calls (plain text)."""
    audio = polly_client.synthesize_speech(
        Text=text,
        OutputFormat="mp3",
        VoiceId=voice_id,
        Engine=engine,
    )
    mp3_bytes = audio["AudioStream"].read()

    marks = polly_client.synthesize_speech(
        Text=text,
        OutputFormat="json",
        SpeechMarkTypes=["word"],
        VoiceId=voice_id,
        Engine=engine,
    )
    marks_jsonlines = marks["AudioStream"].read().decode("utf-8")
    return mp3_bytes, marks_jsonlines


@dataclass
class Synthesis:
    mp3: bytes
    marks_jsonlines: str  # word + sentence marks, JSON lines
    billed_chars: int  # sum of RequestCharacters over both calls


def synthesize_track(polly_client, text: str, voice: VoiceConfig,
                     text_type: str = "ssml") -> Synthesis:
    """Stage 2 synthesis: audio + word/sentence marks with identical input.

    Both calls use the same Text, TextType, VoiceId, Engine and LexiconNames,
    so the marks line up with the audio. Sentence marks are requested too
    (same request, no extra cost) for the sentence-count QA check.
    """
    common = {
        "Text": text,
        "TextType": text_type,
        "VoiceId": voice.voice_id,
        "Engine": voice.engine,
        "LanguageCode": voice.language_code,
    }
    if voice.lexicon_names:
        common["LexiconNames"] = voice.lexicon_names
    audio = polly_client.synthesize_speech(
        OutputFormat="mp3", SampleRate=voice.sample_rate, **common
    )
    marks = polly_client.synthesize_speech(
        OutputFormat="json", SpeechMarkTypes=["word", "sentence"], **common
    )
    return Synthesis(
        mp3=audio["AudioStream"].read(),
        marks_jsonlines=marks["AudioStream"].read().decode("utf-8"),
        billed_chars=int(audio.get("RequestCharacters", 0))
        + int(marks.get("RequestCharacters", 0)),
    )


def ensure_lexicons(polly_client, voices: dict) -> List[str]:
    """Upload each language's PLS lexicon to Polly (idempotent PutLexicon)."""
    names = []
    for v in voices.values():
        if v.lexicon_name and v.lexicon_path and not v.inline_lexicon:
            polly_client.put_lexicon(
                Name=v.lexicon_name,
                Content=v.lexicon_path.read_text(encoding="utf-8"),
            )
            names.append(v.lexicon_name)
    return names
