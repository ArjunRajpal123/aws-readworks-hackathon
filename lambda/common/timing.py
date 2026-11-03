"""Builds the `timestamp` array of word tokens.

Two sources:
  - build_timestamps(word_marks): from Amazon Polly word speech marks
    (kept for when Polly/audio is available again).
  - build_timestamps_from_text(text): text-only tokenizer used now, with
    null start/end since there is no audio alignment yet.
"""
import re

_WORD_RE = re.compile(r"\S+")


def build_timestamps(word_marks):
    """From Polly word speech marks -> [{id, s, e, block}, ...]."""
    timestamps = []
    for i, mark in enumerate(word_marks):
        start = mark["time"]
        end = word_marks[i + 1]["time"] if i + 1 < len(word_marks) else start
        timestamps.append({"id": i, "s": start, "e": end, "block": mark["value"]})
    return timestamps


def build_timestamps_from_text(text):
    """Tokenize raw text -> [{id, s, e, block}, ...] with null timing."""
    timestamps = []
    for i, match in enumerate(_WORD_RE.finditer(text)):
        timestamps.append({"id": i, "s": None, "e": None, "block": match.group(0)})
    return timestamps
