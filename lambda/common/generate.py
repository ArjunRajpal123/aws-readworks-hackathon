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
import logging
import os
import re

import boto3

log = logging.getLogger(__name__)

_client = None
MODEL_ID = os.environ.get("SA_GEN_MODEL", "us.amazon.nova-lite-v1:0")
# Child-safety guardrail applied to every generation call (set at deploy time).
GUARDRAIL_ID = os.environ.get("SA_GUARDRAIL_ID", "").strip()
GUARDRAIL_VERSION = os.environ.get("SA_GUARDRAIL_VERSION", "").strip()


def _bedrock():
    global _client
    if _client is None:
        _client = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION"))
    return _client


def _converse(system, user, max_tokens=1200, guard_text=None):
    """One Converse call. `guard_text` (the untrusted passage) is wrapped in a
    guardContent block so the child-safety guardrail evaluates ONLY it — the
    authoring instructions in `user`/`system` are not guarded (they would trip
    the prompt-attack/topic filters). When no guardrail is set, everything is
    plain text. Returns the model's text (empty if the guardrail intervened)."""
    has_guardrail = bool(GUARDRAIL_ID and GUARDRAIL_VERSION)
    content = [{"text": user}]
    if has_guardrail and guard_text:
        # Evaluate just the passage; keep the instructions out of guardContent.
        content.append({"guardContent": {"text": {"text": guard_text}}})
    kwargs = {
        "modelId": MODEL_ID,
        "system": [{"text": system}],
        "messages": [{"role": "user", "content": content}],
        "inferenceConfig": {"maxTokens": max_tokens, "temperature": 0.2},
    }
    if has_guardrail:
        kwargs["guardrailConfig"] = {
            "guardrailIdentifier": GUARDRAIL_ID,
            "guardrailVersion": GUARDRAIL_VERSION,
            "trace": "disabled",  # never echo flagged content back in a deployed service
        }
    resp = _bedrock().converse(**kwargs)
    blocks = resp.get("output", {}).get("message", {}).get("content", [])
    return "".join(b.get("text", "") for b in blocks)


def _safe_json(system, user, max_tokens=1200, guard_text=None):
    """_converse + _parse_json, returning [] on a guardrail block or bad JSON
    (so callers don't crash when the guardrail empties the response)."""
    try:
        txt = _converse(system, user, max_tokens=max_tokens, guard_text=guard_text)
        return _parse_json(txt) if txt.strip() else []
    except (ValueError, json.JSONDecodeError):
        return []


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
    out = _safe_json(sys, f"Passage:\n{text}\n\nUp to {max_cards} cards.", guard_text=text)
    present = _words(text)
    cards = []
    for c in out if isinstance(out, list) else []:
        w = str(c.get("word", "")).strip()
        if w and w.lower() in present and c.get("def"):
            cards.append({"word": w, "def": str(c["def"])[:200], "ex": str(c.get("ex", ""))[:200]})
        if len(cards) >= max_cards:
            break
    return cards


# ---- autofill passage metadata (title, grade, genre, topic, notes) --------
import datetime  # noqa: E402

AUTOFILL_MODEL = os.environ.get("SA_AUTOFILL_MODEL", MODEL_ID)
_BANDS = ("k2", "35", "68", "912")
_GENRES = ("fiction", "nonfiction", "poetry", "drama", "other")

_AUTOFILL_SYSTEM = (
    "You extract catalog metadata for a K-12 reading passage. Return ONLY a JSON "
    "object with: title (a real, specific title for THIS passage, 3-8 words, never "
    "'Passage about ...'), language ('en-US' or 'es-US'), gradeBand (one of 'k2',"
    "'35','68','912'), grade (0-12, K=0), genre (one of 'fiction','nonfiction',"
    "'poetry','drama','other'), topic (2-4 words naming what it is about — ALWAYS "
    "provide one), notes (one short sentence of guidance for a human reviewer, "
    "<=160 chars). Base every value on the passage. Omit a field only if truly "
    "unknowable (but always give title, topic, genre)."
)


def _model_name(model_id):
    m = (model_id or "").lower()
    for key, name in (("nova-micro", "Nova Micro"), ("nova-lite", "Nova Lite"),
                      ("nova-pro", "Nova Pro"), ("nova", "Nova"),
                      ("haiku", "Claude Haiku"), ("sonnet", "Claude Sonnet"),
                      ("claude", "Claude"), ("llama", "Llama")):
        if key in m:
            return name
    return "AI model"


def autofill_fields(text, lang_hint=None):
    """Draft passage metadata from the text via Bedrock (guardrailed), plus
    server-derived review fields. Returns a dict of fields the admin form reads;
    empty on a guardrail block."""
    global AUTOFILL_MODEL, MODEL_ID
    saved = MODEL_ID
    MODEL_ID = AUTOFILL_MODEL  # _converse uses MODEL_ID
    try:
        out = _safe_json(_AUTOFILL_SYSTEM, f"Passage:\n{text}", guard_text=text)
    finally:
        MODEL_ID = saved
    obj = out if isinstance(out, dict) else (out[0] if isinstance(out, list) and out and isinstance(out[0], dict) else {})

    fields = {}
    title = obj.get("title")
    if isinstance(title, str) and title.strip() and not title.lower().startswith("passage about"):
        fields["title"] = title.strip()[:120]
    lang = obj.get("language") or lang_hint
    if lang in ("en-US", "es-US"):
        fields["language"] = lang
    band = str(obj.get("gradeBand") or "")
    if band in _BANDS:
        fields["gradeBand"] = band
    grade = obj.get("grade")
    if isinstance(grade, (int, float)) and 0 <= grade <= 12:
        fields["grade"] = "K" if int(grade) == 0 else str(int(grade))
    genre = obj.get("genre")
    if genre in _GENRES:
        fields["genre"] = genre
    topic = obj.get("topic")
    if isinstance(topic, str) and topic.strip():
        fields["topic"] = topic.strip()[:60]
    notes = obj.get("notes")
    if isinstance(notes, str) and notes.strip():
        fields["notes"] = notes.strip()[:160]

    # Topic must always be present; fall back to salient words.
    if not fields.get("topic"):
        fields["topic"] = fields.get("title") or _topic_from_text(text)

    # Server-derived review/workflow fields (the "preferences" we implemented):
    attribution = f"Created by {_model_name(AUTOFILL_MODEL)} (AI)"
    fields["reviewer"] = attribution
    fields["spanishReviewer"] = attribution
    slug_src = fields.get("topic") or fields.get("title") or "passage"
    slug = re.sub(r"[^a-z0-9]+", "-", slug_src.lower()).strip("-")[:30] or "passage"
    today = datetime.date.today()
    fields["batchLabel"] = f"ai-{slug}-{today.isoformat()}"
    fields["afterApproval"] = "draft"
    fields["reviewBy"] = (today + datetime.timedelta(days=5)).isoformat()
    return fields


_TOPIC_STOP = {"the", "and", "for", "that", "this", "with", "from", "they", "them",
               "their", "about", "into", "over", "your", "you", "are", "was", "were",
               "has", "have", "had", "but", "not", "can", "will", "would", "when",
               "where", "which", "what", "a", "an", "of", "to", "in", "is", "it",
               "on", "as", "at", "by", "or", "be", "across", "both", "one", "night"}


def _topic_from_text(text):
    words = re.findall(r"[A-Za-z][A-Za-z'-]{3,}", (text or "").lower())
    freq = {}
    for w in words:
        if w in _TOPIC_STOP:
            continue
        freq[w] = freq.get(w, 0) + 1
    top = sorted(freq, key=lambda w: (-freq[w], w))[:2]
    return " ".join(w.capitalize() for w in top) or "General"


# ---- localize cards to another language, matched to the passage -----------
import unicodedata  # noqa: E402


def _norm(w):
    """Match the player's keyFor()/normWord(): lowercase, strip accents and
    non-alphanumerics, so a card word and a passage word compare equal."""
    s = "".join(c for c in unicodedata.normalize("NFD", (w or "").lower())
                if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", s)


def _surface_forms(text):
    """Map normalized form -> original passage token (first occurrence), so a
    matched card word can be shown/stored in its real surface form."""
    forms = {}
    for tok in re.findall(r"\S+", text or ""):
        cleaned = tok.strip(".,;:!?\"'“”¿¡()[]…—–")
        k = _norm(cleaned)
        if k and k not in forms:
            forms[k] = cleaned
    return forms


def _stem_match(norm_word, passage_norms):
    """A passage word sharing a 4+ char stem with norm_word (either direction),
    for inflection (lujo/lujosas). None if no reasonable match."""
    if len(norm_word) < 4:
        return None
    stem = norm_word[:max(4, len(norm_word) - 3)]
    best = None
    for pw in passage_norms:
        if len(pw) < 4:
            continue
        if pw.startswith(stem) or norm_word.startswith(pw[:max(4, len(pw) - 3)]):
            if best is None or abs(len(pw) - len(norm_word)) < abs(len(best) - len(norm_word)):
                best = pw
    return best


# Small function-word lists, used only to tell whether a definition/example is
# still in the source language after the model pass (it often leaves `def`
# untranslated). Deliberately conservative: short text is never flagged.
_EN_HINT = frozenset(
    "the of to and is are was were in on it that this with for as at by from or be "
    "have has had not can will often like into than then there their they them his "
    "her its you your we our when while where which who what how very more most "
    "some such also".split())
_ES_HINT = frozenset(
    "el la los las un una unos unas de del y es son era eran en que se por con "
    "para como al lo su sus más pero muy cuando donde mientras también".split())


def _in_wrong_language(text, lang):
    """True if `text` reads as the OTHER language than `lang` ('es' or 'en')."""
    words = re.findall(r"[a-záéíóúñü']+", (text or "").lower())
    if len(words) < 3:
        return False
    en = sum(w in _EN_HINT for w in words)
    es = sum(w in _ES_HINT for w in words)
    if lang.startswith("es"):
        return en > es and en / len(words) >= 0.2
    return es > en and es / len(words) >= 0.2


def _ensure_language(text, lang):
    """Return `text` in `lang`. If the model left it in the other language,
    machine-translate it (Amazon Translate is reliable for short sentences).
    On a Translate error keep the original so a card is never lost."""
    text = str(text or "")
    if not text or not _in_wrong_language(text, lang):
        return text
    from common.translate import translate_text
    src = "en" if lang.startswith("es") else "es"
    try:
        return translate_text(text, src, lang[:2])
    except Exception:  # noqa: BLE001 - any Translate failure must not drop the card
        log.warning("translate fallback failed for a %s card text", lang, exc_info=True)
        return text


def localize_cards(en_cards, es_text, lang="es"):
    """Translate English vocab cards to `lang`, matched to the surface form the
    word takes in the already-translated passage `es_text`, so the player
    underlines them. Two model passes mirror our design:
      1. translate each card (word+def+ex), with the word AS IT APPEARS in es_text;
      2. a sense check that the translated word is the right MEANING.
    Then a programmatic surface-form repair snaps any off-form word to a passage
    token sharing its stem, and any def/ex the model left in the source language
    is machine-translated. Cards that still can't be matched are dropped.
    Returns [{word, def, ex}] whose words are guaranteed present in es_text.
    """
    cards_in = [c for c in (en_cards or []) if c.get("word")]
    if not cards_in:
        return []
    forms = _surface_forms(es_text)
    passage_norms = list(forms.keys())

    sys = (
        "You translate children's vocabulary cards to " + ("Spanish" if lang.startswith("es") else lang) +
        ", for a reading passage you are given. Return ONLY a JSON array, one object "
        '{"word","def","ex"} per input card, SAME order and SAME count. For each, '
        "set `word` to the translation EXACTLY AS THAT WORD APPEARS in the passage "
        "(same surface form/inflection); translate def and ex too. The word must be "
        "the correct MEANING of the English word, and must be a word present in the "
        "passage. Write `def` and `ex` ENTIRELY in " +
        ("Spanish" if lang.startswith("es") else lang) +
        ", never in English."
    )
    # The passage goes ONLY in guard_text (the guardContent block); putting it
    # in the instruction text too makes the guardrail flag the wrapped copy.
    user = ("Translate these cards for the given passage. Cards:\n" +
            json.dumps([{"word": c["word"], "def": c.get("def", ""), "ex": c.get("ex", "")}
                        for c in cards_in], ensure_ascii=False))
    out = _safe_json(sys, user, max_tokens=1200, guard_text=es_text)
    if not isinstance(out, list):
        return []

    result = []
    for i, c in enumerate(out):
        if not isinstance(c, dict):
            continue
        word = str(c.get("word", "")).strip()
        nk = _norm(word)
        # Snap to a passage surface form: exact first, else stem repair.
        if nk in forms:
            surface = forms[nk]
        else:
            m = _stem_match(nk, passage_norms)
            if not m:
                continue  # can't underline it -> drop
            surface = forms[m]
        card = {"word": surface}
        if c.get("def"):
            card["def"] = _ensure_language(c["def"], lang)[:200]
        if c.get("ex"):
            card["ex"] = _ensure_language(c["ex"], lang)[:200]
        result.append(card)
    return result


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
    out = _safe_json(sys, user, max_tokens=1600, guard_text=text)
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
