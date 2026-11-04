"""pipeline.run end to end with a fake Polly (no AWS).

The fake behaves like real Polly speech marks: word marks carry UTF-8 byte
offsets into the exact input (SSML tags included), punctuation is not part
of the mark, and one sentence mark is emitted per <s>.
"""

import gzip
import json
from dataclasses import replace

import pytest

import pipeline
from pipeline import PassageInput, run
from voices import load_voices

from fakes import FakePolly, FakeStorage

def _run(passage, polly=None):
    polly, storage = polly or FakePolly(), FakeStorage()
    result = run(passage, polly, storage)
    product = json.loads(storage.objects[f"product/{passage.id}.soundAlong.json"][0])
    timing = json.loads(gzip.decompress(storage.objects[product["tracks"][0]["timingKey"]][0]))
    return result, product, timing, storage, polly


def test_english_natural_voice_end_to_end():
    p = PassageInput(id="t-en", lang="en", title="T",
                     text="“Mr. Smith did not sell it,” said Mom. Ana smiled.\n\nStop right there!")
    result, product, timing, storage, polly = _run(p)

    tr = product["tracks"][0]
    assert tr["voiceId"] == "Ruth" and tr["engine"] == "neural"
    assert tr["qa"]["status"] == "passed" and tr["granularity"] == "word"
    assert tr["qa"]["marks"] == product["tokenCount"] == timing["n"]
    # Tokenizer splits after "Mr." (4 sentences); Polly hears 3 real ones.
    assert tr["qa"]["sentences"] == 4
    assert tr["qa"]["pollySentences"] == tr["qa"]["ssmlSentences"] == 3
    assert tr["qa"]["mergedSentenceBreaks"] == [1]
    assert tr["settings"]["textType"] == "ssml" and tr["settings"]["rate"] == "95%"
    assert tr["lexicon"] == "saEnUS"

    # Player contract preserved; schema fields added.
    assert timing["textHash"] == product["textHash"]
    assert {"start", "end", "n", "textHash", "v", "trackId", "durationMs"} <= timing.keys()
    assert timing["durationMs"] == 24000
    assert timing["start"] == sorted(timing["start"]) and len(set(timing["start"])) == timing["n"]
    assert timing["end"][-1] == timing["durationMs"]

    # Both Polly calls: identical SSML input, natural-voice settings, lexicon.
    a, m = polly.calls
    assert a["Text"] == m["Text"] and a["TextType"] == "ssml"
    assert a["Text"].startswith('<speak><amazon:effect name="drc"><prosody rate="95%"><p><s>')
    assert a["LexiconNames"] == ["saEnUS"] and a["SampleRate"] == "24000"
    assert m["SpeechMarkTypes"] == ["word", "sentence"]

    # Review artifacts written; billing recorded.
    assert "audio/t-en/tts-1.marks.jsonl" in storage.objects
    assert storage.objects["audio/t-en/tts-1.input.ssml"][0].decode() == a["Text"]
    assert result["billedChars"] == product["generation"]["billedChars"] > 0
    assert storage.records["t-en"]["tracks"][0]["voiceId"] == "Ruth"


def test_spanish_inverted_marks_and_accents_map_to_tokens():
    p = PassageInput(id="t-es", lang="es", title="T",
                     text="¡Detente ahí mismo! ¿Qué pasó en EE. UU.?")
    _, product, timing, _, polly = _run(p)
    tr = product["tracks"][0]
    assert tr["voiceId"] == "Lupe" and polly.calls[0]["LanguageCode"] == "es-US"
    assert tr["qa"]["status"] == "passed" and tr["qa"]["lowConfidence"] == []
    assert timing["start"][:2] == [0, 300]  # "¡Detente" got its own mark


def test_punctuation_only_token_is_interpolated_not_shifted():
    p = PassageInput(id="t-dash", lang="en", title="T", text="One — two three four.")
    _, product, timing, _, _ = _run(p)
    tr = product["tracks"][0]
    assert tr["qa"]["lowConfidence"] == [1]
    assert timing["start"][0] == 0 and timing["start"][2] == 300  # "two" keeps its own time
    assert 0 <= timing["start"][1] <= 300


def test_pronunciation_override_reaches_polly():
    p = PassageInput(id="t-ov", lang="en", title="T", text="They live here.",
                     pronunciation={"1": {"w": "amazon:VB"}})
    _, product, _, _, polly = _run(p)
    assert '<w role="amazon:VB">live</w>' in polly.calls[0]["Text"]
    assert product["tracks"][0]["settings"]["pronunciationOverrides"] == 1


def test_plain_text_switch_restores_original_request(monkeypatch):
    plain = replace(load_voices()["en"], ssml=False)
    monkeypatch.setattr(pipeline, "voice_for", lambda lang: plain)
    p = PassageInput(id="t-plain", lang="en", title="T", text="Hello there, friend.")
    _, product, _, storage, polly = _run(p)
    assert polly.calls[0]["TextType"] == "text"
    assert polly.calls[0]["Text"] == "Hello there, friend."
    assert product["tracks"][0]["qa"]["status"] == "passed"
    assert "audio/t-plain/tts-1.input.txt" in storage.objects


def test_over_sync_cap_still_refused():
    p = PassageInput(id="t-long", lang="en", title="T", text="word " * 700)
    with pytest.raises(ValueError, match="sync cap"):
        run(p, FakePolly(), FakeStorage())
