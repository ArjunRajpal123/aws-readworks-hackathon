"""POST/GET handlers run the shared pipeline and return the product record.

Fake Polly + in-memory storage; presigned URLs are generated locally by
botocore (no network). No AWS calls.
"""
import json

import pytest

from common import pipeline_runtime, reference_store
from fakes import FakePolly, FakeStorage
from text_to_speech_get import handler as get_mod
from text_to_speech_post import handler as post_mod


@pytest.fixture
def fake_aws(monkeypatch):
    polly, storage = FakePolly(), FakeStorage()
    polly.lexicons = []
    polly.put_lexicon = lambda Name, Content: polly.lexicons.append(Name)
    monkeypatch.setattr(pipeline_runtime, "_cache",
                        {"polly": polly, "storage": storage})
    monkeypatch.setattr(reference_store, "load_record", lambda rid: storage.records.get(rid))
    monkeypatch.setattr(get_mod, "load_record", lambda rid: storage.records.get(rid))
    return polly, storage


def _post(body):
    resp = post_mod.handler({"body": json.dumps(body)}, None)
    return resp["statusCode"], json.loads(resp["body"])


def test_post_runs_pipeline_with_default_voice(fake_aws):
    polly, storage = fake_aws
    status, body = _post({"text": "Ana smiled. Mr. Lee waved.", "id": "demo-1"})
    assert status == 201
    assert body["id"] == "demo-1" and body["lang"] == "en"
    assert [t["id"] for t in body["tracks"]] == ["tts-1"]  # default only: fits the 25s timeout
    tr = body["tracks"][0]
    assert tr["voiceId"] == "Danielle" and tr["qa"]["status"] == "passed"
    assert tr["audioKey"] == "audio/demo-1/tts-1.mp3"
    url = body["urls"]["tts-1"]["audio"]
    # Regional virtual-hosted URL (the global host can 307 outside us-east-1).
    assert url.startswith("https://test-bucket.s3.us-west-2.amazonaws.com/sa/audio/demo-1/tts-1.mp3?")
    assert "X-Amz-Signature" in url  # SigV4 (required for SSE-KMS)
    assert "product/demo-1.soundAlong.json" in storage.objects
    assert "urls" not in storage.records["demo-1"]  # URLs are response-only
    assert sorted(polly.lexicons) == ["saEnUS", "saEsUS"]
    assert all(c["TextType"] == "ssml" for c in polly.calls)


def test_post_spanish_with_extra_voice(fake_aws):
    status, body = _post({"text": "Hola. ¿Cómo estás?", "languageCode": "es-US",
                          "voiceId": "pedro"})
    assert status == 201
    assert [(t["id"], t["voiceId"]) for t in body["tracks"]] == [("tts-1", "Lupe"), ("tts-2", "Pedro")]
    assert set(body["urls"]) == {"tts-1", "tts-2"}


def test_post_all_voices(fake_aws):
    status, body = _post({"text": "Hi there.", "allVoices": True})
    assert status == 201 and len(body["tracks"]) == 2


@pytest.mark.parametrize("body, msg", [
    ({}, "'text' is required"),
    ({"text": "   "}, "'text' is required"),
    ({"text": "x" * 3001}, "3000 characters"),
    ({"text": "hi", "languageCode": "fr-FR"}, "'languageCode'"),
    ({"text": "hi", "id": "../etc/passwd"}, "'id' must match"),
    ({"text": "hi", "voiceId": "Joanna"}, "'voiceId' must be one of the en voices: Danielle, Stephen"),
    ({"text": "hi", "pronunciation": [1]}, "'pronunciation'"),
])
def test_post_validation(fake_aws, body, msg):
    status, resp = _post(body)
    assert status == 400 and msg in resp["error"]


def test_post_bad_json(fake_aws):
    resp = post_mod.handler({"body": "{nope"}, None)
    assert resp["statusCode"] == 400


def test_post_polly_failure_is_502(fake_aws, monkeypatch):
    from botocore.exceptions import ClientError

    polly, _ = fake_aws

    def boom(**kw):
        raise ClientError({"Error": {"Code": "ThrottlingException", "Message": "slow"}},
                          "SynthesizeSpeech")
    monkeypatch.setattr(polly, "synthesize_speech", boom)
    status, resp = _post({"text": "Hello."})
    assert status == 502 and "ThrottlingException" in resp["error"]


def test_get_returns_stored_product_with_fresh_urls(fake_aws):
    _post({"text": "Ana smiled.", "id": "g1"})
    resp = get_mod.handler({"queryStringParameters": {"id": "g1"}}, None)
    body = json.loads(resp["body"])
    assert resp["statusCode"] == 200
    assert body["id"] == "g1" and body["tracks"][0]["timingKey"] == "audio/g1/tts-1.timing.json.gz"
    assert "sa/audio/g1/tts-1.timing.json.gz" in body["urls"]["tts-1"]["timing"]


def test_get_errors(fake_aws):
    assert get_mod.handler({"queryStringParameters": None}, None)["statusCode"] == 400
    assert get_mod.handler({"queryStringParameters": {"id": "missing"}}, None)["statusCode"] == 404
