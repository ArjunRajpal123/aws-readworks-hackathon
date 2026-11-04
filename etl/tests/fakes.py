"""Shared fakes for Stage 2 tests: a Polly that behaves like the real one
(word marks = UTF-8 byte offsets into the exact input, tags included; no mark
for punctuation-only tokens; one sentence mark per <s>) and in-memory storage.
"""

import io
import json
import re

_PUNCT = "\"'“”‘’«»¿¡()[].,;:!?…—–"


def fake_mp3(frames: int = 1000) -> bytes:
    # MPEG-2 Layer III, 48 kbps, 24 kHz, no padding: 144-byte frames, 24 ms each.
    frame = bytes([0xFF, 0xF3, 0x64, 0xC4]) + bytes(140)
    return frame * frames


def fake_marks(text: str) -> str:
    raw = text.encode("utf-8")
    out, t = [], 0
    for m in re.finditer(rb"<s>|<[^>]*>|[^<\s]+", raw):
        tok = m.group(0)
        if tok == b"<s>":
            out.append({"time": t, "type": "sentence", "start": m.end(), "end": m.end(), "value": ""})
            continue
        if tok.startswith(b"<"):
            continue
        word = tok.decode("utf-8")
        core = word.strip(_PUNCT)
        if not core:
            continue  # Polly emits no mark for punctuation-only tokens
        lead = len(word[: len(word) - len(word.lstrip(_PUNCT))].encode("utf-8"))
        b0 = m.start() + lead
        out.append({"time": t, "type": "word", "start": b0,
                    "end": b0 + len(core.encode("utf-8")), "value": core})
        t += 300
    return "\n".join(json.dumps(x) for x in out) + "\n"


class FakePolly:
    """`audio_per_word`: MP3 length follows the word count (300 ms per word,
    like the marks, plus 1 s) instead of a fixed 24 s, for long passages."""

    def __init__(self, audio_per_word: bool = False):
        self.calls = []
        self.audio_per_word = audio_per_word

    def synthesize_speech(self, **kw):
        self.calls.append(kw)
        chars = len(re.sub(r"<[^>]*>", "", kw["Text"]))
        if kw["OutputFormat"] == "mp3":
            words = sum(1 for l in fake_marks(kw["Text"]).splitlines() if '"word"' in l)
            body = fake_mp3(words * 300 // 24 + 42) if self.audio_per_word else fake_mp3()
        else:
            body = fake_marks(kw["Text"]).encode("utf-8")
        return {"AudioStream": io.BytesIO(body), "RequestCharacters": chars}


class FakeStorage:
    def __init__(self):
        self.objects, self.records = {}, {}

    def put_bytes(self, key, data, content_type, content_encoding=None):
        self.objects[key] = (data, content_type, content_encoding)

    def put_record(self, record_id, record):
        self.records[record_id] = record
