"""Tests for audio.build_timing — NO AWS/network calls.

Speech marks are hand-crafted JSONL with UTF-8 BYTE offsets into polly_text
(the tokens joined by single spaces), exactly as Polly emits them. We use
polly_text.encode('utf-8') to compute offsets so the multibyte cases are real.
"""

import json

from audio import Timing, _byte_spans, build_timing
from tokenizer import tokenize


def _polly_text(tokens):
    return " ".join(t.text for t in tokens)


def _marks_from_spans(spans, times, values=None):
    """Build Polly-style word speech-mark JSONL for the given byte spans."""
    lines = []
    for idx, ((b0, b1), tm) in enumerate(zip(spans, times)):
        mark = {"time": int(tm), "type": "word", "start": b0, "end": b1}
        if values is not None:
            mark["value"] = values[idx]
        lines.append(json.dumps(mark))
    return "\n".join(lines)


# --------------------------------------------------------------------------
# Happy path: every token gets a direct mark
# --------------------------------------------------------------------------
def test_build_timing_basic_all_marks_present():
    t = tokenize("The cat sat.", "en")
    tokens = t.tokens
    polly = _polly_text(tokens)
    spans = _byte_spans(tokens, polly)
    times = [100, 250, 480]
    marks = _marks_from_spans(spans, times, [tok.text for tok in tokens])

    duration = 700
    timing = build_timing(
        tokens, polly, marks, duration, "Joanna", "neural", t.text_hash
    )

    assert isinstance(timing, Timing)
    # start[] equals the mark times in token order.
    assert timing.start == [100, 250, 480]
    # end[i] = start[i+1], last end = duration.
    assert timing.end == [250, 480, 700]
    assert timing.n == t.token_count == 3
    assert timing.qa_status == "passed"
    assert timing.low_conf == []
    assert timing.voice_id == "Joanna"
    assert timing.engine == "neural"
    assert timing.duration_ms == duration


# --------------------------------------------------------------------------
# Repeated word: "the cat the dog" — distinct occurrences
# --------------------------------------------------------------------------
def test_repeated_word_maps_to_distinct_occurrences():
    t = tokenize("the cat the dog", "en")
    tokens = t.tokens
    polly = _polly_text(tokens)
    assert polly == "the cat the dog"

    spans = _byte_spans(tokens, polly)
    # Byte spans advance: the two "the" tokens occupy different byte ranges.
    assert spans == [(0, 3), (4, 7), (8, 11), (12, 15)]
    assert spans[0] != spans[2]

    times = [100, 200, 300, 400]
    marks = _marks_from_spans(spans, times)

    timing = build_timing(
        tokens, polly, marks, 500, "Joanna", "neural", t.text_hash
    )

    # Each "the" gets its OWN time, proving they mapped to distinct marks and
    # not both to the first occurrence.
    assert timing.start == [100, 200, 300, 400]
    assert timing.start[0] != timing.start[2]
    assert timing.low_conf == []
    assert timing.qa_status == "passed"


# --------------------------------------------------------------------------
# Spanish multibyte: leading ¿ is 2 UTF-8 bytes
# --------------------------------------------------------------------------
def test_spanish_multibyte_leading_char_time_assigned_correctly():
    t = tokenize("\u00bfPuedes ver?", "es")
    tokens = t.tokens
    polly = _polly_text(tokens)
    assert polly == "\u00bfPuedes ver?"

    # ¿ occupies bytes 0..1, so the first token's byte span starts at 0 and
    # spans the 2-byte ¿ plus "Puedes" (8 bytes total).
    byte_len = len(polly.encode("utf-8"))
    assert byte_len == 13  # 2 (¿) + 6 (Puedes) + 1 (space) + 4 (ver?)
    spans = _byte_spans(tokens, polly)
    assert spans == [(0, 8), (9, 13)]

    times = [50, 170]
    marks = _marks_from_spans(spans, times)

    timing = build_timing(
        tokens, polly, marks, 300, "Lupe", "neural", t.text_hash
    )

    # The first word's time is still assigned despite the multibyte lead char.
    assert timing.start == [50, 170]
    assert timing.end == [170, 300]
    assert timing.low_conf == []
    assert timing.qa_status == "passed"


# --------------------------------------------------------------------------
# Missing mark in the middle -> interpolated, low_conf, still monotonic
# --------------------------------------------------------------------------
def test_missing_middle_mark_is_interpolated_and_flagged():
    t = tokenize("one two three four five", "en")
    tokens = t.tokens
    polly = _polly_text(tokens)
    spans = _byte_spans(tokens, polly)
    times = [100, 200, 300, 400, 500]

    # Drop the mark for token index 2 ("three").
    kept_spans = [s for i, s in enumerate(spans) if i != 2]
    kept_times = [tm for i, tm in enumerate(times) if i != 2]
    marks = _marks_from_spans(kept_spans, kept_times)

    duration = 600
    timing = build_timing(
        tokens, polly, marks, duration, "Joanna", "neural", t.text_hash
    )

    # Token 2 had no direct mark -> flagged low_conf.
    assert timing.low_conf == [2]
    # It still receives an interpolated start between its neighbours (200..400).
    assert 200 <= timing.start[2] <= 400
    assert timing.start[2] == 300  # linear interpolation midpoint
    # All start times are non-decreasing.
    assert all(
        timing.start[i] <= timing.start[i + 1]
        for i in range(len(timing.start) - 1)
    )
    # And end times remain non-decreasing too.
    assert all(
        timing.end[i] <= timing.end[i + 1]
        for i in range(len(timing.end) - 1)
    )


def test_missing_first_mark_defaults_to_zero():
    t = tokenize("alpha beta gamma", "en")
    tokens = t.tokens
    polly = _polly_text(tokens)
    spans = _byte_spans(tokens, polly)
    times = [100, 200, 300]

    # Drop the first mark.
    marks = _marks_from_spans(spans[1:], times[1:])

    timing = build_timing(
        tokens, polly, marks, 400, "Joanna", "neural", t.text_hash
    )

    # First token forced to 0 when no leading anchor exists.
    assert timing.start[0] == 0
    assert 0 in timing.low_conf
    assert all(
        timing.start[i] <= timing.start[i + 1]
        for i in range(len(timing.start) - 1)
    )


# --------------------------------------------------------------------------
# _byte_spans directly on a realistic sentence
# --------------------------------------------------------------------------
def test_byte_spans_match_encoded_substrings():
    t = tokenize("The quick brown fox.", "en")
    tokens = t.tokens
    polly = _polly_text(tokens)
    data = polly.encode("utf-8")
    spans = _byte_spans(tokens, polly)

    # Each span, decoded back, equals the token text.
    for tok, (b0, b1) in zip(tokens, spans):
        assert data[b0:b1].decode("utf-8") == tok.text
