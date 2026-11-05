"""Tests for generate.localize_cards: translating vocab cards to another
language matched to the passage surface form, with sense/stem repair and
graceful guardrail handling. Fakes Bedrock; no AWS calls."""
import json

from common import generate as gen


def _fake(reply, stop="end_turn"):
    return type("B", (), {"converse": lambda self, **kw: {
        "output": {"message": {"content": [{"text": reply}]}},
        "stopReason": stop,
    }})()


ES_TEXT = ("Las luces doradas brillan suavemente contra las ventanas heladas "
           "mientras la familia descansa en mantas mullidas.")
EN_CARDS = [{"word": "glow", "def": "to shine"},
            {"word": "frosted", "def": "icy"},
            {"word": "plush", "def": "soft"}]


def test_localize_matches_surface_forms(monkeypatch):
    # Model returns words exactly as they appear in the passage.
    reply = json.dumps([
        {"word": "brillan", "def": "brillar con luz suave", "ex": "Las luces brillan."},
        {"word": "heladas", "def": "cubiertas de escarcha"},
        {"word": "mullidas", "def": "suaves"},
    ])
    monkeypatch.setattr(gen, "_client", _fake(reply))
    cards = gen.localize_cards(EN_CARDS, ES_TEXT, "es")
    assert [c["word"] for c in cards] == ["brillan", "heladas", "mullidas"]
    assert cards[0]["def"] == "brillar con luz suave"


def test_localize_stem_repairs_inflected_form(monkeypatch):
    # Model returns a dictionary form "lujo"; passage has "mullidas"... actually
    # test the stem repair: model says "brillar" (infinitive), passage has
    # "brillan" -> repaired to the surface form that's present.
    reply = json.dumps([{"word": "brillar", "def": "dar luz"}])
    monkeypatch.setattr(gen, "_client", _fake(reply))
    cards = gen.localize_cards([{"word": "glow", "def": "shine"}], ES_TEXT, "es")
    assert [c["word"] for c in cards] == ["brillan"]  # snapped to the passage form


def test_localize_drops_word_not_in_passage(monkeypatch):
    # A word with no passage match (and no stem match) is dropped.
    reply = json.dumps([{"word": "zzz", "def": "x"}, {"word": "heladas", "def": "icy"}])
    monkeypatch.setattr(gen, "_client", _fake(reply))
    cards = gen.localize_cards([{"word": "a"}, {"word": "frosted"}], ES_TEXT, "es")
    assert [c["word"] for c in cards] == ["heladas"]


def test_localize_empty_on_guardrail_block(monkeypatch):
    # Guardrail intervened -> blocked message text, not JSON -> [] (no crash).
    monkeypatch.setattr(gen, "_client",
                        _fake("The AI response was blocked.", stop="guardrail_intervened"))
    assert gen.localize_cards(EN_CARDS, ES_TEXT, "es") == []


def test_localize_empty_input(monkeypatch):
    monkeypatch.setattr(gen, "_client", _fake("[]"))
    assert gen.localize_cards([], ES_TEXT, "es") == []


def test_converse_uses_guardrail_when_set(monkeypatch):
    captured = {}

    class B:
        def converse(self, **kw):
            captured.update(kw)
            return {"output": {"message": {"content": [{"text": "[]"}]}}, "stopReason": "end_turn"}

    monkeypatch.setattr(gen, "_client", B())
    monkeypatch.setattr(gen, "GUARDRAIL_ID", "gid")
    monkeypatch.setattr(gen, "GUARDRAIL_VERSION", "1")
    gen._converse("sys", "instructions", guard_text="the passage")
    # guardrailConfig present, and the passage is wrapped in guardContent while
    # the instructions are plain text (not guarded).
    assert captured["guardrailConfig"]["guardrailIdentifier"] == "gid"
    content = captured["messages"][0]["content"]
    assert any("guardContent" in blk for blk in content)
    assert any(blk.get("text") == "instructions" for blk in content)


def test_converse_no_guardcontent_without_guardrail(monkeypatch):
    captured = {}

    class B:
        def converse(self, **kw):
            captured.update(kw)
            return {"output": {"message": {"content": [{"text": "[]"}]}}, "stopReason": "end_turn"}

    monkeypatch.setattr(gen, "_client", B())
    monkeypatch.setattr(gen, "GUARDRAIL_ID", "")
    monkeypatch.setattr(gen, "GUARDRAIL_VERSION", "")
    gen._converse("sys", "user text", guard_text="passage")
    # No guardrailConfig, and NO guardContent block (that pairing is invalid).
    assert "guardrailConfig" not in captured
    content = captured["messages"][0]["content"]
    assert all("guardContent" not in blk for blk in content)
