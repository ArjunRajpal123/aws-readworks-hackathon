"""SSML builder: naturalness markup + exact UTF-8 byte span per token.

Polly reports speech-mark offsets as UTF-8 byte offsets into the exact SSML
string sent (verified against Ruth/neural), so every token's span must slice
back to that token's (escaped) text in the document.
"""

import xml.etree.ElementTree as ET
from dataclasses import replace

import pytest

from ssml import Override, build_ssml, load_inline_lexicon, parse_overrides
from tokenizer import tokenize
from voices import load_voices

EN = load_voices()["en"]


def _wellformed(text):
    """Polly accepts the undeclared amazon: prefix; declare it for the XML parser."""
    ET.fromstring(text.replace("<speak>", '<speak xmlns:amazon="urn:amazon">', 1))


def _slices(doc):
    raw = doc.text.encode("utf-8")
    return [raw[b0:b1].decode("utf-8") for b0, b1 in doc.token_spans]


def test_skeleton_paragraphs_and_sentences():
    tk = tokenize("A b. C d?\n\nE f!", lang="en")
    doc = build_ssml(tk, EN)
    assert doc.text == (
        '<speak><amazon:effect name="drc"><prosody rate="95%">'
        "<p><s>A b.</s><s>C d?</s></p><p><s>E f!</s></p>"
        "</prosody></amazon:effect></speak>"
    )


def test_no_drc_and_paragraph_break():
    voice = replace(EN, drc=False, paragraph_break_ms=300, rate="100%")
    tk = tokenize("One two.\n\nThree four.", lang="en")
    doc = build_ssml(tk, voice)
    assert "amazon:effect" not in doc.text
    assert doc.text.count('<break time="300ms"/>') == 1
    assert '</p><break time="300ms"/><p>' in doc.text


def test_spans_slice_back_to_tokens_with_multibyte_text():
    tk = tokenize("“Mr. Señor weighed ½ pound. ¿Qué?", lang="en")
    doc = build_ssml(tk, EN)
    assert _slices(doc) == [t.text for t in tk.tokens]


def test_xml_special_characters_are_escaped():
    tk = tokenize("Tom & Jerry <3 them.", lang="en")
    doc = build_ssml(tk, EN)
    _wellformed(doc.text)  # well-formed
    assert _slices(doc)[1] == "&amp;"
    assert _slices(doc)[3] == "&lt;3"


def test_plain_chars_excludes_tags():
    tk = tokenize("Hello there.\n\nBye.", lang="en")
    doc = build_ssml(tk, EN)
    assert doc.plain_chars == len("Hello there. Bye.")


@pytest.mark.parametrize(
    "ov, expected",
    [
        (Override("w", {"role": "amazon:VB"}), '<w role="amazon:VB">live</w>'),
        (Override("sub", {"alias": "one half"}), '<sub alias="one half">live</sub>'),
        (Override("phoneme", {"alphabet": "ipa", "ph": "lɪv"}),
         '<phoneme alphabet="ipa" ph="lɪv">live</phoneme>'),
        (Override("lang", {"xml:lang": "en-US"}), '<lang xml:lang="en-US">live</lang>'),
        (Override("sayAs", {"interpret-as": "date", "format": "md"}),
         '<say-as interpret-as="date" format="md">live</say-as>'),
    ],
)
def test_override_wraps_the_token(ov, expected):
    tk = tokenize("They live here.", lang="en")
    doc = build_ssml(tk, EN, overrides={1: ov})
    assert _slices(doc)[1] == expected
    _wellformed(doc.text)


def test_parse_overrides_validates():
    ovs = parse_overrides({"1": {"w": "amazon:VB"}, "2": {"sub": "one half"}}, token_count=3)
    assert ovs[1] == Override("w", {"role": "amazon:VB"})
    assert ovs[2] == Override("sub", {"alias": "one half"})
    with pytest.raises(ValueError, match="unknown"):
        parse_overrides({"0": {"bogus": "x"}}, token_count=3)
    with pytest.raises(ValueError, match="out of range"):
        parse_overrides({"3": {"w": "amazon:VB"}}, token_count=3)
    assert parse_overrides(None, token_count=3) == {}


def test_inline_lexicon_applies_alias_ignoring_punctuation(tmp_path):
    pls = tmp_path / "x.pls"
    pls.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<lexicon version="1.0" xmlns="http://www.w3.org/2005/01/pronunciation-lexicon" '
        'alphabet="ipa" xml:lang="en-US">'
        "<lexeme><grapheme>Scottadino</grapheme><alias>Scotta deeno</alias></lexeme>"
        "</lexicon>",
        encoding="utf-8",
    )
    lex = load_inline_lexicon(pls)
    tk = tokenize("“Mr. Scottadino, hi.", lang="en")
    doc = build_ssml(tk, EN, inline_lexicon=lex)
    assert _slices(doc)[1] == '<sub alias="Scotta deeno">Scottadino,</sub>'


def test_per_token_override_wins_over_inline_lexicon(tmp_path):
    lex = {"live": Override("sub", {"alias": "liv"})}
    tk = tokenize("They live here.", lang="en")
    doc = build_ssml(tk, EN, overrides={1: Override("w", {"role": "amazon:VB"})},
                     inline_lexicon=lex)
    assert _slices(doc)[1].startswith("<w ")


def test_repo_lexicon_files_are_valid_pls():
    for v in load_voices().values():
        root = ET.parse(v.lexicon_path).getroot()
        assert root.tag.endswith("lexicon")
        assert load_inline_lexicon(v.lexicon_path)  # at least one entry


def test_config_version_reflects_naturalness_settings():
    assert EN.voice_id == "Danielle"
    assert EN.config_version == "en-US/neural/Danielle/ssml/lex-1/r95%/drc1/pb0"
    assert replace(EN, rate="90%").config_version != EN.config_version
    assert load_voices()["es"].voice_id == "Lupe"


def test_no_sentence_break_after_title_abbreviation():
    tk = tokenize("Surely Mr. Lee had gone home. Then he left.", lang="en")
    assert 2 in tk.sentence_starts  # shared tokenizer splits after "Mr."
    doc = build_ssml(tk, EN)
    assert "<s>Surely Mr. Lee had gone home.</s><s>Then he left.</s>" in doc.text
    assert doc.sentence_count == 2 and doc.merged_breaks == (2,)
    assert _slices(doc) == [t.text for t in tk.tokens]


def test_no_sentence_break_before_lowercase_word():
    tk = tokenize("Laws in the U.S. became strict.", lang="en")
    doc = build_ssml(tk, EN)
    assert "<s>Laws in the U.S. became strict.</s>" in doc.text
    assert doc.sentence_count == 1


def test_spanish_title_abbreviation_kept_in_sentence():
    tk = tokenize("Seguramente el Sr. Lee se había ido.", lang="es")
    doc = build_ssml(tk, load_voices()["es"])
    assert doc.sentence_count == 1
