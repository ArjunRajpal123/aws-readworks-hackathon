"""pipeline.run end to end with a fake Polly (no AWS).

The fake behaves like real Polly speech marks: word marks carry UTF-8 byte
offsets into the exact input (SSML tags included), punctuation is not part
of the mark, and one sentence mark is emitted per <s>.
"""

import gzip
import json
import re
from dataclasses import replace

import pytest

import pipeline
from pipeline import PassageInput, run
from voices import load_voice_tracks, load_voices

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
    assert tr["voiceId"] == "Danielle" and tr["engine"] == "neural"
    assert tr["id"] == "tts-1" and tr["default"] is True and tr["voiceGender"] == "female"
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
    a, m = polly.calls[:2]  # default track (tts-1) first
    assert a["Text"] == m["Text"] and a["TextType"] == "ssml"
    assert a["Text"].startswith('<speak><amazon:effect name="drc"><prosody rate="95%"><p><s>')
    assert a["LexiconNames"] == ["saEnUS"] and a["SampleRate"] == "24000"
    assert m["SpeechMarkTypes"] == ["word", "sentence"]

    # Review artifacts written; billing recorded.
    assert "audio/t-en/tts-1.marks.jsonl" in storage.objects
    assert storage.objects["audio/t-en/tts-1.input.ssml"][0].decode() == a["Text"]
    assert result["billedChars"] == product["generation"]["billedChars"] > 0
    assert storage.records["t-en"]["tracks"][0]["voiceId"] == "Danielle"


def test_spanish_inverted_marks_and_accents_map_to_tokens():
    p = PassageInput(id="t-es", lang="es", title="T",
                     text="¡Detente ahí mismo! ¿Qué pasó en EE. UU.?")
    _, product, timing, _, polly = _run(p)
    tr = product["tracks"][0]
    assert tr["voiceId"] == "Lupe" and polly.calls[0]["LanguageCode"] == "es-US"
    assert [x["voiceId"] for x in product["tracks"]] == ["Lupe", "Pedro"]
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
    monkeypatch.setattr(pipeline, "tracks_for", lambda lang: [plain])
    p = PassageInput(id="t-plain", lang="en", title="T", text="Hello there, friend.")
    _, product, _, storage, polly = _run(p)
    assert polly.calls[0]["TextType"] == "text"
    assert polly.calls[0]["Text"] == "Hello there, friend."
    assert product["tracks"][0]["qa"]["status"] == "passed"
    assert "audio/t-plain/tts-1.input.txt" in storage.objects


def test_one_sentence_over_part_cap_is_refused():
    # 700 words, no sentence end: cannot be split at a paragraph or sentence boundary.
    p = PassageInput(id="t-long", lang="en", title="T", text="word " * 700)
    with pytest.raises(ValueError, match="part cap"):
        run(p, FakePolly(), FakeStorage())


def _long_text(paras=12, sents=4):
    # ~12 x 4 sentences x 12 words: about 4,000 spoken characters (over the 3,000 cap).
    s = "The quick brown fox jumps over the lazy dog near the river bank."
    return "\n\n".join(" ".join([s] * sents) for _ in range(paras))


def test_long_passage_is_split_into_parts_and_joined():
    p = PassageInput(id="t-long2", lang="en", title="T", text=_long_text())
    result, product, timing, storage, polly = _run(p, FakePolly(audio_per_word=True))
    t1 = product["tracks"][0]
    parts = t1["settings"]["parts"]
    assert parts >= 2 and result["tracks"][0]["parts"] == parts
    # Every Polly call stays under the sync caps; audio + marks per part, per voice.
    assert len(polly.calls) == 2 * parts * len(product["tracks"])
    for c in polly.calls:
        assert len(re.sub(r"<[^>]*>", "", c["Text"])) <= pipeline.PART_SPOKEN_CAP
        assert len(c["Text"]) <= pipeline.PART_TOTAL_CAP
    # One time per word across all parts, in order, ending with the joined audio.
    assert timing["n"] == product["tokenCount"] == len(timing["start"])
    assert all(a <= b for a, b in zip(timing["start"], timing["start"][1:]))
    assert timing["end"][-1] == timing["durationMs"] == t1["qa"]["durationMs"]
    assert t1["qa"]["status"] == "passed" and t1["qa"]["lowConfidence"] == []
    assert t1["qa"]["pollySentences"] == t1["qa"]["ssmlSentences"] == len(product["structure"]["sentenceStarts"])
    # Parts start at paragraph boundaries; later parts are offset by the earlier audio.
    para_first = set(product["structure"]["paragraphStarts"])
    # The joined MP3 is every part's audio back to back.
    part_mp3s = [len(c["Text"]) for c in polly.calls if c["VoiceId"] == "Danielle" and c["OutputFormat"] == "mp3"]
    assert len(part_mp3s) == parts
    ssml = storage.objects[f"audio/t-long2/tts-1.input.ssml"][0].decode("utf-8")
    assert ssml.count("<!-- part ") == parts and ssml.startswith("<!-- part 0: tokens 0-")
    starts = [int(x.split("tokens ")[1].split("-")[0]) for x in ssml.split("<!-- part ")[1:]]
    assert set(starts) <= para_first
    marks = [json.loads(l) for l in storage.objects["audio/t-long2/tts-1.marks.jsonl"][0].decode().splitlines()]
    assert {m["part"] for m in marks} == set(range(parts))
    assert timing["start"][starts[1]] >= 1000  # second part starts after the first part's audio


def test_long_single_paragraph_splits_at_sentences():
    p = PassageInput(id="t-long3", lang="en", title="T", text=_long_text(paras=1, sents=48))
    _, product, timing, storage, polly = _run(p, FakePolly(audio_per_word=True))
    t1 = product["tracks"][0]
    assert t1["settings"]["parts"] >= 2 and t1["qa"]["status"] == "passed"
    ssml = storage.objects["audio/t-long3/tts-1.input.ssml"][0].decode("utf-8")
    starts = [int(x.split("tokens ")[1].split("-")[0]) for x in ssml.split("<!-- part ")[1:]]
    assert set(starts) <= set(product["structure"]["sentenceStarts"])


def test_long_passage_pronunciation_override_lands_in_its_part():
    text = _long_text()
    p = PassageInput(id="t-long4", lang="en", title="T", text=text,
                     pronunciation={"600": {"sub": "foxy"}})
    _, product, _, _, polly = _run(p, FakePolly(audio_per_word=True))
    texts = [c["Text"] for c in polly.calls if c["VoiceId"] == "Danielle" and c["OutputFormat"] == "mp3"]
    hits = [k for k, t in enumerate(texts) if 'alias="foxy"' in t]
    assert len(hits) == 1 and hits[0] >= 1  # token 600 is in a later part


def test_short_passage_is_one_part():
    p = PassageInput(id="t-short", lang="en", title="T", text="Hello there. Bye now.")
    _, product, _, storage, polly = _run(p)
    assert product["tracks"][0]["settings"]["parts"] == 1
    assert "<!-- part" not in storage.objects["audio/t-short/tts-1.input.ssml"][0].decode()
    assert len(polly.calls) == 4


def test_two_voice_tracks_female_default_then_male():
    p = PassageInput(id="t-two", lang="en", title="T", text="Hello there, friend. Bye now.")
    result, product, timing, storage, polly = _run(p)
    t1, t2 = product["tracks"]
    assert (t1["id"], t1["voiceId"], t1["voiceGender"], t1["default"]) == ("tts-1", "Danielle", "female", True)
    assert (t2["id"], t2["voiceId"], t2["voiceGender"], t2["default"]) == ("tts-2", "Stephen", "male", False)
    assert [c["VoiceId"] for c in polly.calls] == ["Danielle", "Danielle", "Stephen", "Stephen"]
    for tr in (t1, t2):
        assert tr["qa"]["status"] == "passed"
        assert tr["audioKey"] == f"audio/t-two/{tr['id']}.mp3" and tr["audioKey"] in storage.objects
        tm = json.loads(gzip.decompress(storage.objects[tr["timingKey"]][0]))
        assert tm["trackId"] == tr["id"] and tm["textHash"] == product["textHash"]
    # The player plays tracks[0]: still the female default.
    assert timing["trackId"] == "tts-1"
    assert result["voiceId"] == "Danielle" and [s["track"] for s in result["tracks"]] == ["tts-1", "tts-2"]
    assert result["billedChars"] == t1["qa"]["billedChars"] + t2["qa"]["billedChars"]
    # Product record is written after every track's files.
    keys = list(storage.objects)
    assert keys[-1] == "product/t-two.soundAlong.json"


def test_track_filter_keeps_default_only():
    p = PassageInput(id="t-one", lang="es", title="T", text="Hola, amigo.")
    polly = FakePolly()
    result = run(p, polly, FakeStorage(), track_ids=[])
    assert [s["track"] for s in result["tracks"]] == ["tts-1"]
    assert {c["VoiceId"] for c in polly.calls} == {"Lupe"}


def test_voices_config_validation(tmp_path):
    bad = tmp_path / "v.json"
    bad.write_text(json.dumps({"voices": {"en": {"languageCode": "en-US", "engine": "neural",
        "tracks": [{"id": "tts-1", "voiceId": "A"}, {"id": "tts-2", "voiceId": "B"}]}}}), encoding="utf-8")
    with pytest.raises(ValueError, match="exactly one default"):
        load_voice_tracks(bad)
    v1 = tmp_path / "v1.json"
    v1.write_text(json.dumps({"voices": {"en": {"languageCode": "en-US", "engine": "neural",
        "voiceId": "Joanna"}}}), encoding="utf-8")
    (only,) = load_voice_tracks(v1)["en"]
    assert (only.voice_id, only.track_id, only.default) == ("Joanna", "tts-1", True)
