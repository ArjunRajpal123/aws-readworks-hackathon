"""POST /api/v1/assist: validate + autofill via Bedrock (faked, no AWS calls).

A fake bedrock-runtime client stands in for Converse so the handler's parsing,
validation, guardrail handling and field coercion are tested offline.
"""
import json

import pytest

from assist import handler as mod


class FakeBedrock:
    """Returns a scripted Converse response. `script` maps modelId substring ->
    (text, stopReason)."""
    def __init__(self, script):
        self.script = script
        self.calls = []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        text, stop = "", "end_turn"
        for key, (t, s) in self.script.items():
            if key in kwargs["modelId"]:
                text, stop = t, s
                break
        return {
            "output": {"message": {"content": [{"text": text}]}},
            "stopReason": stop,
            "usage": {"inputTokens": 10, "outputTokens": 5},
        }


@pytest.fixture
def no_guardrail(monkeypatch):
    # Tests drive behaviour via the fake client; no real guardrail.
    monkeypatch.setattr(mod, "GUARDRAIL_ID", "")
    monkeypatch.setattr(mod, "GUARDRAIL_VERSION", "")


def _use(monkeypatch, fake):
    monkeypatch.setattr(mod, "_bedrock", lambda: fake)


def _post(body):
    resp = mod.handler({"body": json.dumps(body)}, None)
    return resp["statusCode"], json.loads(resp["body"])


ADEQUATE = "The clever fox watched the sunrise over the quiet hills every single morning."


def test_validate_ok(monkeypatch, no_guardrail):
    _use(monkeypatch, FakeBedrock({"nova-micro": ("OK: Clear and age-appropriate.", "end_turn")}))
    status, body = _post({"text": ADEQUATE, "mode": "validate"})
    assert status == 200
    assert body["ok"] is True
    assert body["feedback"].startswith("OK")


def test_validate_fix(monkeypatch, no_guardrail):
    _use(monkeypatch, FakeBedrock({"nova-micro": ("FIX: Sentence fragment, please expand.", "end_turn")}))
    status, body = _post({"text": ADEQUATE, "mode": "validate"})
    assert status == 200 and body["ok"] is False and body["feedback"].startswith("FIX")


def test_validate_guardrail_block_is_not_ok(monkeypatch, no_guardrail):
    _use(monkeypatch, FakeBedrock({"nova-micro": ("", "guardrail_intervened")}))
    status, body = _post({"text": ADEQUATE, "mode": "validate"})
    assert status == 200 and body["ok"] is False and body["blocked"] is True


def test_autofill_parses_and_coerces_fields(monkeypatch, no_guardrail):
    payload = json.dumps({
        "title": "The Clever Fox", "language": "en-US", "gradeBand": "35",
        "grade": 4, "genre": "fiction", "topic": "A fox at sunrise",
        "vocabulary": [
            {"word": "clever", "pos": "adjective", "def": "quick to understand", "ex": "The clever fox."},
            {"word": "sunrise", "pos": "noun", "def": "when the sun comes up"},
            {"word": "x"},            # too short -> dropped
            {"word": "CLEVER"},       # duplicate (case) -> dropped
        ],
    })
    _use(monkeypatch, FakeBedrock({"nova-lite": (payload, "end_turn")}))
    status, body = _post({"text": ADEQUATE, "mode": "autofill"})
    assert status == 200
    f = body["fields"]
    assert f["title"] == "The Clever Fox"
    assert f["language"] == "en-US" and f["gradeBand"] == "35"
    assert f["grade"] == "4" and f["genre"] == "fiction"
    # Vocabulary is now a list of cards; "x" and the dup are dropped.
    cards = body["vocabulary"]
    assert [c["word"] for c in cards] == ["clever", "sunrise"]
    assert cards[0] == {"word": "clever", "pos": "adjective", "def": "quick to understand", "ex": "The clever fox."}
    assert "ex" not in cards[1]  # partial card (no example) still allowed
    # Server-derived workflow/attribution fields (not from the model):
    assert f["reviewer"] == "Created by Nova Lite (AI)"  # AUTOFILL_MODEL default
    assert f["spanishReviewer"] == "Created by Nova Lite (AI)"  # same attribution, always set
    assert f["afterApproval"] == "draft"
    assert f["batchLabel"].startswith("ai-")
    # reviewBy is an ISO date in the future.
    import datetime
    assert datetime.date.fromisoformat(f["reviewBy"]) > datetime.date.today()


def test_autofill_spanish_sets_spanish_reviewer(monkeypatch, no_guardrail):
    _use(monkeypatch, FakeBedrock({"nova-lite": (json.dumps(
        {"title": "El Zorro", "language": "es-US", "genre": "fiction"}), "end_turn")}))
    _, body = _post({"text": ADEQUATE, "mode": "autofill"})
    f = body["fields"]
    assert f["language"] == "es-US"
    assert f["reviewer"] == "Created by Nova Lite (AI)"
    assert f["spanishReviewer"] == "Created by Nova Lite (AI)"


def test_autofill_notes_passthrough(monkeypatch, no_guardrail):
    _use(monkeypatch, FakeBedrock({"nova-lite": (json.dumps(
        {"notes": "Nonfiction about foxes; check the word 'acacia'."}), "end_turn")}))
    _, body = _post({"text": ADEQUATE, "mode": "autofill"})
    assert body["fields"]["notes"].startswith("Nonfiction about foxes")


def test_autofill_topic_falls_back_to_title(monkeypatch, no_guardrail):
    # Model omits topic -> falls back to the title.
    _use(monkeypatch, FakeBedrock({"nova-lite": (json.dumps({"title": "Germs and Vaccines"}), "end_turn")}))
    _, body = _post({"text": ADEQUATE, "mode": "autofill"})
    assert body["fields"]["topic"] == "Germs and Vaccines"


def test_autofill_topic_falls_back_to_text_when_no_title(monkeypatch, no_guardrail):
    # No topic and no title -> derive from the passage's salient words (never blank).
    _use(monkeypatch, FakeBedrock({"nova-lite": ("{}", "end_turn")}))
    _, body = _post({"text": "Volcano volcano volcano erupts with molten lava and glowing ash.", "mode": "autofill"})
    assert body["fields"]["topic"]  # non-empty
    assert "volcano" in body["fields"]["topic"].lower()


def test_translate_returns_spanish_text_and_cards(monkeypatch, no_guardrail):
    payload = json.dumps({
        "text": "El zorro astuto observó el amanecer.",
        "title": "El Zorro Astuto",
        "vocabulary": [
            {"word": "astuto", "pos": "adjetivo", "def": "listo", "ex": "El zorro astuto."},
            {"word": "amanecer", "pos": "sustantivo", "def": "cuando sale el sol"},
        ],
    })
    _use(monkeypatch, FakeBedrock({"nova-lite": (payload, "end_turn")}))
    status, body = _post({
        "text": "The clever fox watched the sunrise over the quiet hills.", "mode": "translate",
        "vocabularyCards": [{"word": "clever"}, {"word": "sunrise"}],
    })
    assert status == 200
    assert body["text"].startswith("El zorro astuto")
    assert body["title"] == "El Zorro Astuto"
    assert [c["word"] for c in body["vocabularyCards"]] == ["astuto", "amanecer"]
    assert body["model"] == "Nova Lite"


def test_translate_guardrail_block(monkeypatch, no_guardrail):
    _use(monkeypatch, FakeBedrock({"nova-lite": ("", "guardrail_intervened")}))
    status, body = _post({"text": "The clever fox watched the sunrise over the quiet hills.", "mode": "translate"})
    assert status == 200 and body.get("blocked") is True


def test_translate_empty_output_is_502(monkeypatch, no_guardrail):
    _use(monkeypatch, FakeBedrock({"nova-lite": ("no json here", "end_turn")}))
    status, resp = _post({"text": "The clever fox watched the sunrise over the quiet hills.", "mode": "translate"})
    assert status == 502


class SeqBedrock:
    """Returns scripted (text, stop) responses in call order."""
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        text, stop = self.responses[min(len(self.calls) - 1, len(self.responses) - 1)]
        return {"output": {"message": {"content": [{"text": text}]}},
                "stopReason": stop, "usage": {"inputTokens": 10, "outputTokens": 5}}


def test_translate_sense_pass_corrects_wrong_sense_word(monkeypatch, no_guardrail):
    # 1st call = translation: picks "suavemente" for "plush" (wrong sense), but
    #            the passage also contains "mullidas".
    # 2nd call = sense check: returns ["mullidas"] as the correction.
    es_text = "Las mantas mullidas abrigan mientras la luz brilla suavemente."
    translate_out = json.dumps({"text": es_text, "title": "Mantas",
                                "vocabulary": [{"word": "suavemente", "pos": "adj", "def": "suave"}]})
    sense_out = '["mullidas"]'
    _use(monkeypatch, SeqBedrock([(translate_out, "end_turn"), (sense_out, "end_turn")]))
    status, body = _post({
        "text": "The plush blankets are warm while the light glows softly here.",
        "mode": "translate", "vocabularyCards": [{"word": "plush", "def": "soft and luxurious"}],
    })
    assert status == 200
    # The sense pass replaced the wrong-sense word with the correct one that is
    # present in the passage.
    assert body["vocabularyCards"][0]["word"] == "mullidas"


def test_sense_pass_repairs_surface_form_to_passage_word(monkeypatch, no_guardrail):
    # Translation picks "lujo" (right sense, wrong form); passage has "lujosas".
    # Sense check returns the same word; the stem-repair maps it to "lujosas".
    es_text = "Las mantas lujosas abrigan la casa."
    translate_out = json.dumps({"text": es_text, "vocabulary": [{"word": "lujo", "def": "x"}]})
    _use(monkeypatch, SeqBedrock([(translate_out, "end_turn"), ('["lujo"]', "end_turn")]))
    _, body = _post({"text": "The plush blankets warm the whole house tonight.",
                     "mode": "translate", "vocabularyCards": [{"word": "plush", "def": "luxurious"}]})
    assert body["vocabularyCards"][0]["word"] == "lujosas"  # repaired to the passage surface form


def test_sense_pass_keeps_first_word_when_correction_not_in_passage(monkeypatch, no_guardrail):
    es_text = "El zorro curioso observó el amanecer."
    translate_out = json.dumps({"text": es_text,
                                "vocabulary": [{"word": "curioso", "def": "x"}]})
    # Sense check suggests a word NOT in the passage -> must be ignored.
    _use(monkeypatch, SeqBedrock([(translate_out, "end_turn"), ('["inteligente"]', "end_turn")]))
    _, body = _post({"text": "The clever fox watched the sunrise over the hills.",
                     "mode": "translate", "vocabularyCards": [{"word": "clever", "def": "smart"}]})
    assert body["vocabularyCards"][0]["word"] == "curioso"  # kept first-pass


def test_translate_keeps_accented_vocab(monkeypatch, no_guardrail):
    _use(monkeypatch, FakeBedrock({"nova-lite": (json.dumps(
        {"text": "Hola mundo bonito aquí.", "vocabulary": [{"word": "bonito"}, {"word": "aquí"}]}), "end_turn")}))
    _, body = _post({"text": "Hello beautiful world here right now today friends.", "mode": "translate"})
    assert [c["word"] for c in body["vocabularyCards"]] == ["bonito", "aquí"]


def test_autofill_vocab_accepts_bare_strings(monkeypatch, no_guardrail):
    # Backward-compatible: a model that returns plain strings is wrapped as {word}.
    _use(monkeypatch, FakeBedrock({"nova-lite": (json.dumps(
        {"vocabulary": ["acacia", "wonder"]}), "end_turn")}))
    _, body = _post({"text": ADEQUATE, "mode": "autofill"})
    assert body["vocabulary"] == [{"word": "acacia"}, {"word": "wonder"}]


def test_autofill_grade_k_maps_to_letter(monkeypatch, no_guardrail):
    _use(monkeypatch, FakeBedrock({"nova-lite": (json.dumps({"grade": 0, "gradeBand": "k2"}), "end_turn")}))
    _, body = _post({"text": ADEQUATE, "mode": "autofill"})
    assert body["fields"]["grade"] == "K" and body["fields"]["gradeBand"] == "k2"


def test_autofill_drops_out_of_range_and_unknown(monkeypatch, no_guardrail):
    _use(monkeypatch, FakeBedrock({"nova-lite": (json.dumps(
        {"gradeBand": "college", "grade": 99, "genre": "manifesto", "language": "fr-FR"}), "end_turn")}))
    _, body = _post({"text": ADEQUATE, "mode": "autofill"})
    f = body["fields"]
    # Every model-provided value is rejected; only the server-derived
    # workflow/attribution fields remain (topic falls back to the passage text).
    for k in ("gradeBand", "grade", "genre", "language", "title"):
        assert k not in f
    assert set(f) == {"reviewer", "spanishReviewer", "batchLabel", "afterApproval", "reviewBy", "topic"}


def test_autofill_tolerates_prose_around_json(monkeypatch, no_guardrail):
    out = "Here you go:\n```json\n{\"title\": \"Foxes\", \"genre\": \"nonfiction\"}\n```\nHope that helps!"
    _use(monkeypatch, FakeBedrock({"nova-lite": (out, "end_turn")}))
    _, body = _post({"text": ADEQUATE, "mode": "autofill"})
    assert body["fields"]["title"] == "Foxes" and body["fields"]["genre"] == "nonfiction"


def test_autofill_unparseable_returns_empty(monkeypatch, no_guardrail):
    _use(monkeypatch, FakeBedrock({"nova-lite": ("I could not do that.", "end_turn")}))
    _, body = _post({"text": ADEQUATE, "mode": "autofill"})
    assert body["fields"] == {} and body["vocabulary"] == []


def test_autofill_guardrail_block(monkeypatch, no_guardrail):
    _use(monkeypatch, FakeBedrock({"nova-lite": ("", "guardrail_intervened")}))
    _, body = _post({"text": ADEQUATE, "mode": "autofill"})
    assert body["blocked"] is True and body["fields"] == {}


@pytest.mark.parametrize("body, msg", [
    ({"text": "short", "mode": "validate"}, "at least"),
    ({"text": "x" * 3001, "mode": "validate"}, "at most"),
    ({"text": ADEQUATE, "mode": "bogus"}, "'mode'"),
])
def test_validation_errors(monkeypatch, no_guardrail, body, msg):
    _use(monkeypatch, FakeBedrock({}))
    status, resp = _post(body)
    assert status == 400 and msg in resp["error"]


def test_bad_json_body(monkeypatch, no_guardrail):
    _use(monkeypatch, FakeBedrock({}))
    resp = mod.handler({"body": "{nope"}, None)
    assert resp["statusCode"] == 400


def test_bedrock_clienterror_is_502(monkeypatch, no_guardrail):
    from botocore.exceptions import ClientError

    class Boom:
        def converse(self, **kw):
            raise ClientError({"Error": {"Code": "ThrottlingException", "Message": "slow"}}, "Converse")

    _use(monkeypatch, Boom())
    status, resp = _post({"text": ADEQUATE, "mode": "validate"})
    assert status == 502
    # Don't leak internals; generic message.
    assert "Throttling" not in resp["error"]


def test_guardrail_config_passed_when_set(monkeypatch):
    monkeypatch.setattr(mod, "GUARDRAIL_ID", "gid123")
    monkeypatch.setattr(mod, "GUARDRAIL_VERSION", "1")
    fake = FakeBedrock({"nova-micro": ("OK: good", "end_turn")})
    _use(monkeypatch, fake)
    _post({"text": ADEQUATE, "mode": "validate"})
    gc = fake.calls[0]["guardrailConfig"]
    assert gc["guardrailIdentifier"] == "gid123" and gc["guardrailVersion"] == "1"
    assert gc["trace"] == "disabled"
    # User text is wrapped in a guardContent block.
    assert "guardContent" in fake.calls[0]["messages"][0]["content"][0]
