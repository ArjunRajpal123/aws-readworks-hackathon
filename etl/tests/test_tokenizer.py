"""Tests for tokenizer.tokenize — verifies ACTUAL behavior of the module.

Covers token counting, data-w HTML indices, sentence/paragraph starts,
trailing-quote sentence detection, Spanish handling, and textHash stability.
"""

import re

from tokenizer import TOKENIZER_VERSION, compute_text_hash, tokenize


# --------------------------------------------------------------------------
# Simple one-sentence passage
# --------------------------------------------------------------------------
def test_single_sentence_token_count_and_starts():
    t = tokenize("The cat sat.", "en")

    assert t.token_count == 3
    assert [tok.text for tok in t.tokens] == ["The", "cat", "sat."]
    # Every token is numbered 0..n-1 in order.
    assert [tok.i for tok in t.tokens] == [0, 1, 2]
    # One paragraph, one sentence, both starting at token 0.
    assert t.paragraph_starts == [0]
    assert t.sentence_starts == [0]
    # All tokens belong to paragraph 0, sentence 0.
    assert all(tok.para == 0 for tok in t.tokens)
    assert all(tok.sentence == 0 for tok in t.tokens)


def test_single_sentence_html_data_w_indices():
    t = tokenize("The cat sat.", "en")

    # data-w indices must be 0,1,2 in order and wrap the escaped word text.
    data_w = re.findall(r'data-w="(\d+)"', t.content_tokenized)
    assert data_w == ["0", "1", "2"]
    assert '<span data-w="0">The</span>' in t.content_tokenized
    assert '<span data-w="1">cat</span>' in t.content_tokenized
    assert '<span data-w="2">sat.</span>' in t.content_tokenized
    # Wrapped in a single paragraph.
    assert t.content_tokenized.startswith("<p>")
    assert t.content_tokenized.endswith("</p>")


def test_html_escapes_special_characters():
    # A word containing HTML-significant chars must be escaped in the span.
    t = tokenize("a<b>c", "en")
    assert "&lt;b&gt;" in t.content_tokenized
    # The raw unescaped form must not leak into the HTML.
    assert "<b>c" not in t.content_tokenized


# --------------------------------------------------------------------------
# Multi-paragraph text
# --------------------------------------------------------------------------
def test_multi_paragraph_starts_and_new_sentence():
    t = tokenize("First para here.\n\nSecond para now.", "en")

    assert t.token_count == 6
    # One paragraph_starts entry per paragraph, each at the right token index.
    assert t.paragraph_starts == [0, 3]
    assert t.tokens[0].text == "First"
    assert t.tokens[3].text == "Second"
    assert t.tokens[0].para == 0
    assert t.tokens[3].para == 1
    # A new paragraph forces a new sentence, so the second paragraph's first
    # token is a sentence start and a distinct sentence index.
    assert 3 in t.sentence_starts
    assert t.tokens[3].sentence == t.tokens[2].sentence + 1


def test_multi_paragraph_forces_new_sentence_without_terminal_punctuation():
    # First paragraph has NO sentence-final punctuation; the paragraph break
    # alone must still start a fresh sentence.
    t = tokenize("no period here\n\nnext paragraph", "en")

    assert t.paragraph_starts == [0, 3]
    assert t.tokens[0].sentence == 0
    assert t.tokens[3].sentence == 1
    assert t.sentence_starts == [0, 3]


# --------------------------------------------------------------------------
# Multi-sentence text (sentence-final punctuation, trailing quotes)
# --------------------------------------------------------------------------
def test_multi_sentence_starts_align_after_punctuation():
    t = tokenize("The cat sat. The dog ran.", "en")

    # Two sentences within one paragraph.
    assert t.paragraph_starts == [0]
    assert t.sentence_starts == [0, 3]
    assert t.tokens[3].text == "The"
    assert t.tokens[2].sentence == 0
    assert t.tokens[3].sentence == 1


def test_sentence_end_with_trailing_closing_quote():
    # `said."` ends a sentence even though the final char is a quote.
    t = tokenize("He said \u201cgo.\u201d Then she left.", "en")

    # The token carrying the closing quote is the sentence terminator.
    assert t.tokens[2].text == "\u201cgo.\u201d"
    # The next sentence starts at the token right after it.
    assert t.sentence_starts == [0, 3]
    assert t.tokens[3].text == "Then"
    assert t.tokens[3].sentence == 1


def test_exclamation_and_question_end_sentences():
    t = tokenize("Wow! Really? Yes.", "en")
    assert t.sentence_starts == [0, 1, 2]
    assert [tok.sentence for tok in t.tokens] == [0, 1, 2]


# --------------------------------------------------------------------------
# textHash stability
# --------------------------------------------------------------------------
def test_text_hash_stable_for_identical_input():
    a = tokenize("The cat sat on the mat.", "en")
    b = tokenize("The cat sat on the mat.", "en")
    assert a.text_hash == b.text_hash
    assert a.text_hash.startswith("sha256:")


def test_text_hash_changes_when_a_word_changes():
    a = tokenize("The cat sat.", "en")
    b = tokenize("The dog sat.", "en")
    assert a.text_hash != b.text_hash


def test_text_hash_changes_when_lang_changes():
    a = tokenize("El gato.", "en")
    b = tokenize("El gato.", "es")
    assert a.text_hash != b.text_hash


def test_text_hash_matches_direct_compute():
    t = tokenize("The cat sat.", "en")
    direct = compute_text_hash(t.tokens, "en", TOKENIZER_VERSION["en"])
    assert t.text_hash == direct


# --------------------------------------------------------------------------
# Spanish
# --------------------------------------------------------------------------
def test_spanish_keeps_inverted_question_and_accents():
    t = tokenize("\u00bfPuedes ver el oc\u00e9ano?", "es")

    assert [tok.text for tok in t.tokens] == [
        "\u00bfPuedes",  # ¿ stays attached to the first word
        "ver",
        "el",
        "oc\u00e9ano?",  # accented char intact, trailing ? attached
    ]
    assert t.tokenizer_version == "sa-tok-es-1.0"
    assert t.lang == "es"
    # Single sentence/paragraph.
    assert t.sentence_starts == [0]
    assert t.paragraph_starts == [0]


def test_spanish_inverted_marks_preserved_in_html():
    t = tokenize("\u00a1Hola!", "es")
    assert '<span data-w="0">\u00a1Hola!</span>' in t.content_tokenized
