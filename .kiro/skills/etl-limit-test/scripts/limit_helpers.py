"""Input generators and fakes for the ETL limit tests and the limit probe.

Offline only: ScalingPolly / FailingPolly / FailingStorage never touch AWS.
"""
from __future__ import annotations

import io
import re

from botocore.exceptions import ClientError

from fakes import FakePolly, FakeStorage, fake_marks

# Sentences used to build realistic passages of an exact spoken length.
EN_SENTENCE = "The quick brown fox jumps over the lazy dog."
ES_SENTENCE = "¿Cómo está la niña? ¡Él comió piñas rápidamente!"

MS_PER_WORD = 300  # fake_marks spaces word marks 300 ms apart
FRAME_MS = 24  # fake MP3 frame (MPEG-2 L3, 24 kHz) = 24 ms


def spoken_text(n_chars: int, lang: str = "en") -> str:
    """Text whose spoken form (tokens joined by single spaces) is exactly n_chars.

    That is the length the pipeline compares against Polly's 3000-char cap.
    """
    if n_chars <= 0:
        return ""
    base = (ES_SENTENCE if lang == "es" else EN_SENTENCE).split(" ")
    words: list[str] = []
    length, i = 0, 0
    while True:
        w = base[i % len(base)]
        add = len(w) + (1 if words else 0)
        if length + add > n_chars:
            break
        words.append(w)
        length += add
        i += 1
    short = n_chars - length
    if short:
        if not words:
            words.append("a" * short)
        elif short == 1:
            words[-1] += "s"
        else:
            words.append("a" * (short - 1))
    text = " ".join(words)
    assert len(text) == n_chars, (len(text), n_chars)
    return text


def mp3_frames(n_frames: int) -> bytes:
    frame = bytes([0xFF, 0xF3, 0x64, 0xC4]) + bytes(140)
    return frame * n_frames


def throttle_error(op: str = "SynthesizeSpeech", code: str = "ThrottlingException") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": "Rate exceeded"}}, op)


class ScalingPolly(FakePolly):
    """FakePolly whose audio length matches the word marks it returns.

    The stock FakePolly always returns 24 s of audio, so long inputs fail QA
    (last mark after the end of the audio) for reasons that have nothing to
    do with the pipeline. This one returns enough audio for every mark.
    """

    def synthesize_speech(self, **kw):
        self.calls.append(kw)
        chars = len(re.sub(r"<[^>]*>", "", kw["Text"]))
        marks = fake_marks(kw["Text"])
        if kw["OutputFormat"] == "mp3":
            n_words = marks.count('"type": "word"')
            frames = max(10, (n_words + 2) * MS_PER_WORD // FRAME_MS)
            body = mp3_frames(frames)
        else:
            body = marks.encode("utf-8")
        return {"AudioStream": io.BytesIO(body), "RequestCharacters": chars}


class FailingPolly(ScalingPolly):
    """Raises `error` on the call numbers in `fail_on` (1-based)."""

    def __init__(self, fail_on, error=None):
        super().__init__()
        self.fail_on = set(fail_on)
        self.error = error or throttle_error()
        self.n = 0

    def synthesize_speech(self, **kw):
        self.n += 1
        if self.n in self.fail_on:
            self.calls.append(kw)
            raise self.error
        return super().synthesize_speech(**kw)


class FailingStorage(FakeStorage):
    """Raises a ClientError on the k-th put_bytes (1-based)."""

    def __init__(self, fail_at: int):
        super().__init__()
        self.fail_at = fail_at
        self.puts = 0

    def put_bytes(self, key, data, content_type, content_encoding=None):
        self.puts += 1
        if self.puts == self.fail_at:
            raise throttle_error("PutObject", "SlowDown")
        super().put_bytes(key, data, content_type, content_encoding)
