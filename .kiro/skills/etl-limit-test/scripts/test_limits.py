"""ETL + API limit tests. Offline: fake Polly and in-memory storage, no AWS calls.

Groups:
  size       Polly sync caps (3000 spoken chars, 6000 total SSML chars) at the boundary
  input      edge-case inputs (empty, unknown language, huge tokens, bad overrides)
  faults     Polly throttling and S3 failures: what gets written, what the API returns
  capacity   DynamoDB item size and CPU time at the cap

Tests marked xfail(strict=True) are KNOWN GAPS: they describe the behaviour we
want. When someone fixes the gap the test XPASSes, strict mode fails the run,
and the marker should be removed.

Run:  .venv-etl/bin/python -m pytest .kiro/skills/etl-limit-test/scripts -q
"""
from __future__ import annotations

import json
import time

import pytest

import audio as audio_mod
import mp3duration
import pipeline
from fakes import FakeStorage
from limit_helpers import (
    FailingPolly,
    FailingStorage,
    ScalingPolly,
    mp3_frames,
    spoken_text,
)
from pipeline import PassageInput, run
from voices import tracks_for

CAP = audio_mod.SYNC_CHAR_CAP  # 3000 spoken characters
SSML_CAP = pipeline.SYNC_TOTAL_CHAR_CAP  # 6000 characters including SSML tags
DYNAMO_ITEM_LIMIT = 400 * 1024
CALLS_PER_TRACK = 2  # mp3 + speech marks


def _passage(text, lang="en", pid="lim", **kw):
    return PassageInput(id=pid, lang=lang, title=pid, text=text, **kw)


def _run(text, lang="en", track_ids=None, polly=None, storage=None, **kw):
    polly = polly or ScalingPolly()
    storage = storage if storage is not None else FakeStorage()
    result = run(_passage(text, lang, **kw), polly, storage, track_ids=track_ids)
    return result, polly, storage


# --------------------------------------------------------------------------- size


@pytest.mark.parametrize("lang", ["en", "es"])
@pytest.mark.parametrize("n", [1, CAP - 1, CAP])
def test_size_at_or_under_cap_is_synthesized(lang, n):
    result, polly, storage = _run(spoken_text(n, lang), lang)
    assert len(polly.calls) == CALLS_PER_TRACK * len(tracks_for(lang))
    assert result["qa"] == "passed"
    assert "product/lim.soundAlong.json" in storage.objects


@pytest.mark.parametrize("lang", ["en", "es"])
@pytest.mark.parametrize("n", [CAP + 1, CAP * 2])
def test_size_over_cap_is_rejected_before_any_polly_call(lang, n):
    polly, storage = ScalingPolly(), FakeStorage()
    with pytest.raises(ValueError, match="sync cap"):
        run(_passage(spoken_text(n, lang), lang), polly, storage)
    assert polly.calls == [] and storage.objects == {} and storage.records == {}


def test_size_cap_counts_characters_not_bytes():
    # 3000 Spanish characters is ~3300 UTF-8 bytes; the cap is on characters,
    # which is what Polly bills.
    text = spoken_text(CAP, "es")
    assert len(text.encode("utf-8")) > CAP
    result, _, _ = _run(text, "es")
    assert result["qa"] == "passed"


def test_size_billed_chars_match_spoken_chars():
    result, _, _ = _run(spoken_text(CAP), "en", track_ids=[])
    # One track, two requests (audio + marks), each billed for at most the
    # spoken text (tags are free; spaces between </s><s> are not sent).
    assert 0.9 * 2 * CAP <= result["billedChars"] <= 2 * CAP
    assert result["estCostUsd"] == pytest.approx(
        result["billedChars"] * pipeline.NEURAL_USD_PER_MCHAR / 1_000_000, abs=1e-5)


def test_size_short_sentences_hit_the_ssml_cap_below_3000_spoken_chars():
    # Each <s>...</s> adds 7 characters of tags, so passages made of very
    # short sentences exceed the 6000 total-char cap well before 3000 spoken.
    text = "Hi. " * 600  # ~2400 spoken chars
    polly = ScalingPolly()
    with pytest.raises(ValueError):
        run(_passage(text), polly, FakeStorage())
    assert polly.calls == []


def test_size_xml_escaping_counts_toward_the_ssml_cap():
    # "&" is sent as "&amp;": 1 spoken char, 5 SSML chars.
    text = " ".join(["&"] * 1500)  # 2999 spoken chars
    with pytest.raises(ValueError):
        run(_passage(text), ScalingPolly(), FakeStorage())


def test_size_find_largest_passing_input():
    """Binary search the largest plain-sentence input the pipeline accepts."""
    lo, hi = 1, CAP * 2
    while lo < hi:
        mid = (lo + hi + 1) // 2
        try:
            _run(spoken_text(mid), "en", track_ids=[])
            lo = mid
        except ValueError:
            hi = mid - 1
    assert lo == CAP


# -------------------------------------------------------------------------- input


@pytest.mark.xfail(strict=True, reason="KNOWN GAP: empty text is sent to Polly "
                   "(pays for 4 requests, real Polly may reject); should be a ValueError")
@pytest.mark.parametrize("text", ["", "   \n\n  "])
def test_input_empty_text_is_rejected_before_polly(text):
    polly = ScalingPolly()
    with pytest.raises(ValueError):
        run(_passage(text), polly, FakeStorage())
    assert polly.calls == []


def test_input_unknown_language_falls_back_to_english_voice():
    result, polly, _ = _run("Bonjour le monde.", "fr", track_ids=[])
    assert polly.calls[0]["VoiceId"] == tracks_for("en")[0].voice_id
    assert result["voiceId"] == tracks_for("en")[0].voice_id


def test_input_single_3000_char_token():
    result, _, storage = _run("x" * CAP, "en", track_ids=[])
    assert result["tokenCount"] == 1 and result["qa"] == "passed"


def test_input_max_token_count_at_cap():
    # 1500 one-letter words = 2999 spoken chars: the most tokens that fit.
    text = " ".join(["a"] * 1500)
    result, _, storage = _run(text, "en")
    assert result["tokenCount"] == 1500 and result["qa"] == "passed"
    timing_keys = [k for k in storage.objects if k.endswith(".timing.json.gz")]
    assert len(timing_keys) == len(tracks_for("en"))


def test_input_punctuation_only_tokens_degrade_to_sentence_timing():
    # Polly emits no word mark for punctuation-only tokens, so every token is
    # interpolated and QA falls back to sentence highlighting (it never blocks).
    result, _, storage = _run(" ".join(["—"] * 1000), "en", track_ids=[])
    assert result["qa"] == audio_mod.QA_FALLBACK
    assert "product/lim.soundAlong.json" in storage.objects


@pytest.mark.parametrize("override", [{"999999": {"w": "amazon:VB"}}, {"0": {"nope": "x"}}])
def test_input_bad_pronunciation_override_is_rejected_before_polly(override):
    polly = ScalingPolly()
    with pytest.raises(ValueError):
        run(_passage("Hello there.", pronunciation=override), polly, FakeStorage())
    assert polly.calls == []


# ------------------------------------------------------------------------- faults

# Calls with the default en config: 1,2 = tts-1 mp3/marks, 3,4 = tts-2 mp3/marks.


@pytest.mark.parametrize("fail_on", [1, 2, 3, 4])
def test_faults_polly_throttle_on_any_call_writes_nothing(fail_on):
    from botocore.exceptions import ClientError

    polly, storage = FailingPolly({fail_on}), FakeStorage()
    with pytest.raises(ClientError, match="ThrottlingException"):
        run(_passage(spoken_text(500)), polly, storage)
    # All tracks are synthesized before anything is written: no partial passage.
    assert storage.objects == {} and storage.records == {}


def test_faults_no_app_level_retry_on_throttle():
    # The ETL relies on botocore's built-in retries. A throttle that survives
    # them fails the passage; the runners log it and move to the next one.
    from botocore.exceptions import ClientError

    polly = FailingPolly({1})
    with pytest.raises(ClientError):
        run(_passage("Hello there."), polly, FakeStorage())
    assert len(polly.calls) == 1


def _n_puts(text="Hello there."):
    storage = FakeStorage()
    run(_passage(text), ScalingPolly(), storage)
    return len(storage.objects)


@pytest.mark.parametrize("fail_at", range(1, 10))
def test_faults_storage_failure_never_leaves_a_product_record(fail_at):
    from botocore.exceptions import ClientError

    total = _n_puts()
    if fail_at > total:
        pytest.skip(f"only {total} objects are written")
    storage = FailingStorage(fail_at)
    with pytest.raises(ClientError):
        run(_passage("Hello there."), ScalingPolly(), storage)
    # The product JSON and the DynamoDB record are written last, so a failed
    # run never publishes a passage that points at missing audio/timing.
    assert "product/lim.soundAlong.json" not in storage.objects
    assert storage.records == {}


# --- API (Lambda POST handler) -----------------------------------------------


@pytest.fixture
def api(monkeypatch):
    from common import pipeline_runtime, reference_store
    from text_to_speech_post import handler as post_mod

    state = {"polly": ScalingPolly(), "storage": FakeStorage()}
    # POST refuses ids that already exist; answer that lookup from the fake
    # storage so the test stays offline (no DynamoDB call).
    monkeypatch.setattr(reference_store, "load_record",
                        lambda rid: state["storage"].records.get(rid))

    def use(polly=None, storage=None):
        if polly is not None:
            state["polly"] = polly
        if storage is not None:
            state["storage"] = storage
        state["polly"].put_lexicon = lambda Name, Content: None
        monkeypatch.setattr(pipeline_runtime, "_cache", {"polly": state["polly"],
                                                         "storage": state["storage"],
                                                         "lexicons": True})
        return state["polly"], state["storage"]

    def post(body):
        resp = post_mod.handler({"body": json.dumps(body)}, None)
        return resp["statusCode"], json.loads(resp["body"])

    use()
    return use, post


@pytest.mark.parametrize("lang", ["en", "es"])
def test_api_text_at_cap_is_201_and_over_cap_is_400(api, lang):
    use, post = api
    status, _ = post({"text": spoken_text(CAP, lang), "lang": lang, "id": "cap"})
    assert status == 201
    polly, _ = use(polly=ScalingPolly())
    status, body = post({"text": spoken_text(CAP + 1, lang), "lang": lang})
    assert status == 400 and "3000" in body["error"]
    assert polly.calls == []


def test_api_ssml_cap_rejection_is_400_not_500(api):
    _, post = api
    status, body = post({"text": "Hi. " * 600})
    assert status == 400 and "sync cap" in body["error"]


def test_api_polly_throttle_is_502_and_writes_nothing(api):
    use, post = api
    _, storage = use(polly=FailingPolly({1}), storage=FakeStorage())
    status, body = post({"text": "Hello there."})
    assert status == 502 and "ThrottlingException" in body["error"]
    assert storage.objects == {} and storage.records == {}


def test_api_s3_failure_is_502_without_a_record(api):
    use, post = api
    _, storage = use(storage=FailingStorage(1))
    status, _ = post({"text": "Hello there."})
    assert status == 502
    assert storage.records == {}


def test_api_all_voices_at_cap_makes_four_polly_calls(api):
    # Two tracks x (mp3 + marks), sequential, inside the 25 s Lambda timeout.
    use, post = api
    polly, _ = use(polly=ScalingPolly())
    status, _ = post({"text": spoken_text(CAP), "allVoices": True})
    assert status == 201 and len(polly.calls) == 4


# ----------------------------------------------------------------------- capacity


@pytest.mark.parametrize("text", [
    " ".join(["a"] * 1500),  # most tokens
    " ".join(["—"] * 1500),  # most tokens, every one low-confidence
    spoken_text(CAP, "es"),
], ids=["max-tokens", "max-low-confidence", "es-at-cap"])
def test_capacity_dynamodb_item_fits_with_margin(text):
    _, _, storage = _run(text, "es" if "¿" in text else "en")
    item = json.dumps(next(iter(storage.records.values())), ensure_ascii=False)
    size = len(item.encode("utf-8"))
    # JSON size is a close upper-bound proxy for the DynamoDB item size.
    assert size < DYNAMO_ITEM_LIMIT // 2, f"product record is {size} bytes"


def test_capacity_pipeline_cpu_time_at_cap_all_tracks():
    # Fake Polly costs ~0, so this is the pipeline's own CPU time. It must
    # stay small next to the 25 s Lambda timeout, which real Polly mostly uses.
    text = " ".join(["a"] * 1500)
    t0 = time.perf_counter()
    for _ in range(3):
        _run(text, "en")
    per_run = (time.perf_counter() - t0) / 3
    assert per_run < 1.0, f"{per_run:.2f}s per run"


def test_capacity_mp3duration_on_long_audio():
    # 3000 chars at 95% rate is ~4 min of audio; test 30 min for headroom.
    frames = 30 * 60 * 1000 // 24
    data = mp3_frames(frames)
    t0 = time.perf_counter()
    ms = mp3duration.duration_ms(data)
    elapsed = time.perf_counter() - t0
    assert ms == pytest.approx(30 * 60 * 1000, abs=24)
    assert elapsed < 2.0, f"{elapsed:.2f}s to parse {len(data)} bytes"
