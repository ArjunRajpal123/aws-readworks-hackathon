"""GET /api/v1/passages: lists generated passages as lightweight summaries.

Fakes the DynamoDB scan (no AWS calls). The handler imports scan_records by
name, so we patch it on the handler module.
"""
import json

import pytest

from text_to_speech_list import handler as list_mod


def _list():
    resp = list_mod.handler({}, None)
    return resp["statusCode"], json.loads(resp["body"])


def _records(monkeypatch, records):
    # The handler projects a subset of attributes; the fake ignores the
    # projection and just returns whatever records the test supplies.
    monkeypatch.setattr(list_mod, "scan_records", lambda attributes=None: records)


def test_lists_passages_as_summaries(monkeypatch):
    _records(monkeypatch, [
        {"id": "user-abc", "title": "My Passage", "lang": "en", "band": "35",
         "tracks": [{"id": "tts-1", "voiceId": "Danielle"},
                    {"id": "tts-2", "voiceId": "Stephen"}]},
        {"id": "rws-e1-en", "title": "Built-in", "lang": "en",
         "tracks": [{"id": "tts-1", "voiceId": "Danielle"}]},
    ])
    status, body = _list()
    assert status == 200
    passages = body["passages"]
    assert len(passages) == 2
    mine = next(p for p in passages if p["id"] == "user-abc")
    assert mine["title"] == "My Passage"
    assert mine["lang"] == "en"
    assert mine["band"] == "35"
    assert mine["tracks"] == ["Danielle", "Stephen"]  # voice names, de-duped, in order


def test_summary_defaults_and_is_response_only(monkeypatch):
    # No title, no band, no tracks: title falls back to id, band is null,
    # tracks is empty. No urls or heavy fields leak into the listing.
    _records(monkeypatch, [{"id": "bare", "lang": "es"}])
    status, body = _list()
    assert status == 200
    p = body["passages"][0]
    assert p == {"id": "bare", "title": "bare", "lang": "es", "band": None,
                 "tracks": [], "reviewStatus": None, "provenance": None}


def test_sorted_by_band_then_title(monkeypatch):
    _records(monkeypatch, [
        {"id": "c", "title": "Zebra", "lang": "en", "band": "35"},
        {"id": "a", "title": "Apple", "lang": "en", "band": "35"},
        {"id": "b", "title": "Middle", "lang": "en", "band": "k2"},
    ])
    _, body = _list()
    # Bands sort lexically ("35" before "k2"), then title within a band.
    assert [p["id"] for p in body["passages"]] == ["a", "c", "b"]


def test_skips_records_without_an_id(monkeypatch):
    _records(monkeypatch, [{"title": "ghost"}, {"id": "real", "title": "Real", "lang": "en"}])
    _, body = _list()
    assert [p["id"] for p in body["passages"]] == ["real"]


def test_empty_table_returns_empty_list(monkeypatch):
    _records(monkeypatch, [])
    status, body = _list()
    assert status == 200 and body == {"passages": []}


def test_scan_failure_is_a_generic_502(monkeypatch):
    def boom(attributes=None):
        raise RuntimeError("arn:aws:dynamodb:...:table/secret-name")

    monkeypatch.setattr(list_mod, "scan_records", boom)
    status, body = _list()
    assert status == 502
    # Must not leak the table name / ARN / internals to an open endpoint.
    assert "arn:" not in body["error"] and "secret-name" not in body["error"]
