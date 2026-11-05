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

    def fake_get_product(rid):
        obj = storage.objects.get(f"product/{rid}.soundAlong.json")
        return json.loads(obj[0]) if obj else None

    monkeypatch.setattr(get_mod, "get_product", fake_get_product)
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
    resp = post_mod.handler({"body": "not base64!", "isBase64Encoded": True}, None)
    assert resp["statusCode"] == 400


def test_post_base64_encoded_body(fake_aws):
    # HTTP API sends this when the client omits Content-Type: application/json.
    import base64

    raw = json.dumps({"text": "¡Hola!", "lang": "es", "id": "b64"}).encode("utf-8")
    resp = post_mod.handler({"body": base64.b64encode(raw).decode(), "isBase64Encoded": True}, None)
    body = json.loads(resp["body"])
    assert resp["statusCode"] == 201 and body["id"] == "b64" and body["tracks"][0]["voiceId"] == "Lupe"


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


def _get(params):
    resp = get_mod.handler({"queryStringParameters": params}, None)
    return resp["statusCode"], json.loads(resp["body"])


def test_get_voice_id_selects_that_track_only(fake_aws):
    _post({"text": "Ana smiled.", "id": "g2", "allVoices": True})
    status, body = _get({"id": "g2", "voiceId": "stephen"})
    assert status == 200
    stephen = next(t for t in body["tracks"] if t["voiceId"] == "Stephen")
    assert body["selectedTrack"] == stephen["id"]
    assert list(body["urls"]) == [stephen["id"]]
    assert len(body["tracks"]) > 1  # the record itself is unchanged


def test_get_unknown_voice_falls_back_to_default(fake_aws):
    _post({"text": "Ana smiled.", "id": "g3"})
    status, body = _get({"id": "g3", "voiceId": "Nobody"})
    assert status == 200 and body["selectedTrack"] == "tts-1"
    assert list(body["urls"]) == ["tts-1"]


def test_get_without_voice_id_signs_every_track(fake_aws):
    _post({"text": "Ana smiled.", "id": "g4", "allVoices": True})
    status, body = _get({"id": "g4"})
    assert status == 200 and "selectedTrack" not in body
    assert sorted(body["urls"]) == sorted(t["id"] for t in body["tracks"])


def test_get_lang_returns_the_other_language_version(fake_aws):
    _post({"text": "Ana smiled.", "id": "p1"})
    _post({"text": "Ana sonrió.", "id": "p1es", "languageCode": "es-US"})
    _post({"text": "Ana smiled.", "id": "s1-en"})
    _post({"text": "Ana sonrió.", "id": "s1-es", "lang": "es"})

    status, body = _get({"id": "p1", "lang": "es", "voiceId": "Pedro"})
    assert status == 200 and body["id"] == "p1es" and body["lang"] == "es"
    assert body["selectedTrack"] == "tts-1"  # Pedro not generated: default (Lupe)
    status, body = _get({"id": "p1es", "languageCode": "en-US"})
    assert status == 200 and body["id"] == "p1"
    status, body = _get({"id": "s1-en", "lang": "es"})
    assert status == 200 and body["id"] == "s1-es"
    status, body = _get({"id": "s1-en", "lang": "en"})  # already that language
    assert status == 200 and body["id"] == "s1-en"


def test_get_lang_errors(fake_aws):
    _post({"text": "Ana smiled.", "id": "only-en"})
    status, body = _get({"id": "only-en", "lang": "es"})
    assert status == 404 and "only-es" in body["error"]
    assert _get({"id": "only-en", "lang": "fr"})[0] == 400


def test_get_errors(fake_aws):
    assert get_mod.handler({"queryStringParameters": None}, None)["statusCode"] == 400
    assert get_mod.handler({"queryStringParameters": {"id": "missing"}}, None)["statusCode"] == 404


# ---- Open-endpoint guards: never overwrite, bounded inputs ------------------

def test_post_existing_id_is_rejected_and_nothing_is_overwritten(fake_aws):
    polly, storage = fake_aws
    status, _ = _post({"text": "Ana smiled.", "id": "dup-1", "title": "Original"})
    assert status == 201
    objects_before = dict(storage.objects)
    record_before = storage.records["dup-1"]
    calls_before = len(polly.calls)

    status, resp = _post({"text": "Totally different words here.", "id": "dup-1",
                          "title": "Hijack"})

    assert status == 409 and "already exists" in resp["error"]
    assert storage.objects == objects_before            # no file rewritten
    assert storage.records["dup-1"] is record_before    # record untouched
    assert storage.records["dup-1"]["title"] == "Original"
    assert len(polly.calls) == calls_before             # no Polly spend


def test_post_cannot_overwrite_a_preexisting_catalog_record(fake_aws):
    polly, storage = fake_aws
    # A record the API did not create (e.g. written by etl/run_aws.py).
    storage.records["rws-e1-en"] = {"id": "rws-e1-en", "title": "Catalog"}
    status, _ = _post({"text": "Hello.", "id": "rws-e1-en"})
    assert status == 409
    assert polly.calls == [] and not storage.objects
    assert storage.records["rws-e1-en"]["title"] == "Catalog"


def test_post_without_id_skips_the_existence_lookup(fake_aws, monkeypatch):
    import re

    def forbidden(rid):
        raise AssertionError("generated ids must not trigger a lookup")

    monkeypatch.setattr(reference_store, "load_record", forbidden)
    status, body = _post({"text": "Hello there."})
    assert status == 201 and re.fullmatch(r"[0-9a-f]{32}", body["id"])


def test_post_lookup_failure_fails_closed_with_a_generic_502(fake_aws, monkeypatch):
    from botocore.exceptions import ClientError

    polly, storage = fake_aws

    def denied(rid):
        raise ClientError({"Error": {"Code": "AccessDeniedException",
                                     "Message": "arn:aws:iam::123456789012:role/x"}}, "GetItem")

    monkeypatch.setattr(reference_store, "load_record", denied)
    status, resp = _post({"text": "Hi.", "id": "new-1"})
    assert status == 502
    assert "AccessDenied" not in resp["error"] and "arn:" not in resp["error"]
    assert polly.calls == [] and not storage.objects and not storage.records


@pytest.mark.parametrize("bad", [".", "..", ".hidden", "-x", "_x", "a b", "a/b",
                                 "a\\b", "\u00e9", "x" * 65])
def test_post_rejects_unsafe_ids(fake_aws, bad):
    status, resp = _post({"text": "hi", "id": bad})
    assert status == 400 and "'id' must match" in resp["error"]


def test_post_accepts_inner_dots_dashes_underscores(fake_aws):
    status, body = _post({"text": "Hi there.", "id": "rws-e1.en_v2"})
    assert status == 201 and body["id"] == "rws-e1.en_v2"


def test_post_title_length_cap(fake_aws):
    assert _post({"text": "Hi there.", "id": "t200", "title": "a" * 200})[0] == 201
    status, resp = _post({"text": "Hi there.", "id": "t201", "title": "a" * 201})
    assert status == 400 and "'title'" in resp["error"]


def test_post_valid_pronunciation_override_is_applied(fake_aws):
    polly, _ = fake_aws
    status, _ = _post({"text": "Add 1/2 cup.", "id": "pron-ok",
                       "pronunciation": {"1": {"sub": "one half"}}})
    assert status == 201
    assert any('alias="one half"' in c["Text"] for c in polly.calls)


@pytest.mark.parametrize("pron", [
    {"0": 5},                        # spec is not an object
    {"0": {"phoneme": "x"}},         # phoneme must be {"ph": ...}
    {"0": {"phoneme": {}}},          # missing "ph"
    {"0": {"w": 123}},               # non-string value (only fails when SSML is built)
    {"0": {"nope": "x"}},            # unknown kind
    {"0": {"sub": "a", "w": "b"}},   # ambiguous kind
    {"99": {"sub": "x"}},            # index out of range
    {"abc": {"sub": "x"}},           # index is not a number
])
def test_post_malformed_pronunciation_is_a_400_before_any_polly_call(fake_aws, pron):
    polly, storage = fake_aws
    status, resp = _post({"text": "Ana smiled.", "id": "pron-bad", "pronunciation": pron})
    assert status == 400 and "'pronunciation'" in resp["error"]
    assert polly.calls == [] and not storage.objects and not storage.records
