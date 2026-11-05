"""Bedrock-backed vocabulary cards and Word Stops.

Uses the Converse API (bedrock-runtime) with a cross-region inference profile
and an explicit maxTokens, per the Bedrock guidance. The model returns JSON,
which we parse defensively. Word Stops then pass four publish checks before
they are kept -- a draft that fails a check is dropped, never shown.

Word Stop publish checks (mirrors the design doc):
  1. the word is one of the passage's tagged vocab occurrences,
  2. every clue word appears in the passage,
  3. exactly one choice is marked correct,
  4. the correct choice matches the provided definition (word present in it,
     or a high word overlap), so the model can't invent a meaning.
"""

import json
import os
import re

import boto3

_client = None
MODEL_ID = os.environ.get("SA_GEN_MODEL", "us.amazon.nova-lite-v1:0")


def _bedrock():
    global _client
    if _client is None:
        _client = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION"))
    return _client


def _converse(system, user, max_tokens=1200):
    resp = _bedrock().converse(
        modelId=MODEL_ID,
        system=[{"text": system}],
        messages=[{"role": "user", "content": [{"text": user}]}],
        inferenceConfig={"maxTokens": max_tokens, "temperature": 0.2},
    )
    return resp["output"]["message"]["content"][0]["text"]


def _parse_json(text):
    """Pull the first JSON object/array out of a model reply."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\n?|\n?```$", "", text).strip()
    m = re.search(r"[\[{].*[\]}]", text, re.S)
    if not m:
        raise ValueError("model did not return JSON")
    return json.loads(m.group(0))


_WORD = re.compile(r"[\w'-]+", re.UNICODE)


def _words(s):
    return set(w.lower() for w in _WORD.findall(s or ""))


# ---- vocabulary cards -----------------------------------------------------
def vocab_cards(text, lang="en", max_cards=8):
    """Draft {word, def, ex} cards for notable words actually in the passage."""
    sys = (
        "You write child-friendly vocabulary cards for a K-12 read-along app. "
        'Return ONLY a JSON array of objects {"word", '
        '"def" (one short sentence, grade-appropriate), '
        '"ex" (a short example sentence using the word)}. '
        "Choose only words that appear in the passage. "
        + ("Write in Spanish. " if lang.startswith("es") else "Write in English. ")
    )
    out = _parse_json(_converse(sys, f"Passage:\n{text}\n\nUp to {max_cards} cards."))
    present = _words(text)
    cards = []
    for c in out if isinstance(out, list) else []:
        w = str(c.get("word", "")).strip()
        if w and w.lower() in present and c.get("def"):
            cards.append({"word": w, "def": str(c["def"])[:200], "ex": str(c.get("ex", ""))[:200]})
        if len(cards) >= max_cards:
            break
    return cards


# ---- word stops -----------------------------------------------------------
def _passable(stop, text_words, vocab_words):
    """The four publish checks. Returns True only if all pass."""
    word = str(stop.get("word", "")).lower()
    choices = stop.get("choices") or []
    clue = stop.get("clue") or ""
    if word not in vocab_words:                                   # 1
        return False
    if not _words(clue) <= text_words:                            # 2
        return False
    correct = [c for c in choices if c.get("correct")]
    if len(correct) != 1:                                         # 3
        return False
    definition = _words(stop.get("def", ""))
    chosen = _words(correct[0].get("text", ""))
    overlap = len(definition & chosen) / max(1, len(definition))
    if word not in chosen and overlap < 0.4:                      # 4
        return False
    return True


def word_stops(text, vocab, lang="en", max_stops=6):
    """Draft multiple-choice Word Stops for the passage's tagged vocab.

    `vocab` is the list of card words that may anchor a stop. Only stops that
    pass all four checks are returned; the rest are dropped.
    """
    vocab_words = set(w.lower() for w in vocab)
    if not vocab_words:
        return []
    sys = (
        "You write one multiple-choice vocabulary question (a 'Word Stop') per "
        "target word for a K-12 read-along. Return ONLY a JSON array of "
        "{\"word\", \"def\" (the intended meaning), \"clue\" (a short phrase, "
        "every word of which appears in the passage), \"choices\": [{\"text\","
        " \"correct\": true|false}] with exactly ONE correct choice and 3 "
        "plausible wrong ones}. Use only target words that appear in the passage. "
        + ("Write in Spanish. " if lang.startswith("es") else "Write in English. ")
    )
    user = f"Passage:\n{text}\n\nTarget words: {', '.join(sorted(vocab_words))}\nUp to {max_stops} Word Stops."
    out = _parse_json(_converse(sys, user, max_tokens=1600))
    text_words = _words(text)
    kept = []
    for s in out if isinstance(out, list) else []:
        if _passable(s, text_words, vocab_words):
            kept.append({
                "word": s["word"], "def": str(s.get("def", ""))[:200],
                "clue": str(s.get("clue", ""))[:200],
                "choices": [{"text": str(c.get("text", ""))[:120], "correct": bool(c.get("correct"))}
                            for c in s["choices"]],
            })
        if len(kept) >= max_stops:
            break
    return kept
