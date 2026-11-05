"""POST /api/v1/assist — AI help for the "Fill in with AI" button in the admin
content form (frontend/src/assist.js, admin.js).

The button is a two-step flow, kept deliberately cheap:

  mode=validate  — a short, cheap pass (Amazon Nova Micro, tiny maxTokens):
                   is the pasted text adequate to publish as a kids' reading
                   passage? Returns {ok, feedback} with *brief* feedback so it
                   barely costs anything. The admin shows the feedback and only
                   proceeds to autofill when ok is true.

  mode=autofill  — if the text is adequate, a single structured pass
                   (Amazon Nova Lite) fills the rest of the form: title, grade,
                   band, genre, topic and a few vocabulary words. Returns
                   {fields, vocabulary}; the admin marks every field it fills
                   with an "AI" badge and records it in the submission payload.

Both passes run through a Bedrock Guardrail (child-safety content filters +
a denied-topic), because this is a K-12 product. A human still reviews the
filled form and clicks Submit — the AI never submits to the pipeline itself.

Models and the guardrail come from env vars so they can be tuned without a
code change:
  ASSIST_VALIDATE_MODEL  (default us.amazon.nova-micro-v1:0)
  ASSIST_AUTOFILL_MODEL  (default us.amazon.nova-lite-v1:0)
  ASSIST_GUARDRAIL_ID / ASSIST_GUARDRAIL_VERSION (optional; applied when set)
"""

import base64
import datetime
import json
import logging
import os
import re

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from common.responses import error_response, json_response

logger = logging.getLogger()
logger.setLevel(logging.INFO)

MAX_TEXT_CHARS = 3000  # same ceiling the pipeline enforces (Polly sync cap)
MIN_TEXT_CHARS = 40    # below this there's nothing to assess

VALIDATE_MODEL = os.environ.get("ASSIST_VALIDATE_MODEL", "us.amazon.nova-micro-v1:0")
AUTOFILL_MODEL = os.environ.get("ASSIST_AUTOFILL_MODEL", "us.amazon.nova-lite-v1:0")
GUARDRAIL_ID = os.environ.get("ASSIST_GUARDRAIL_ID", "").strip()
GUARDRAIL_VERSION = os.environ.get("ASSIST_GUARDRAIL_VERSION", "").strip()

BANDS = ("k2", "35", "68", "912")
GENRES = ("fiction", "nonfiction", "poetry", "drama", "other")

_client = None


def _today():
    return datetime.date.today().isoformat()


def _days_from_today(n):
    return (datetime.date.today() + datetime.timedelta(days=n)).isoformat()


def _bedrock():
    global _client
    if _client is None:
        _client = boto3.client(
            "bedrock-runtime",
            region_name=os.environ.get("AWS_REGION", "us-west-2"),
            config=Config(retries={"max_attempts": 4, "mode": "adaptive"}),
        )
    return _client


def _guardrail_config():
    """guardrailConfig for a Converse call, or None if no guardrail is set."""
    if not (GUARDRAIL_ID and GUARDRAIL_VERSION):
        return None
    return {
        "guardrailIdentifier": GUARDRAIL_ID,
        "guardrailVersion": GUARDRAIL_VERSION,
        # Never "enabled" in a deployed service: trace output echoes the
        # content that tripped the filter back into the response.
        "trace": "disabled",
    }


def _converse(model_id, system, user_text, max_tokens, temperature=0.2):
    """One Converse call. User text is wrapped in a guardContent block so the
    guardrail evaluates the (untrusted) passage, not the system prompt.
    Returns (text, stop_reason, usage)."""
    kwargs = {
        "modelId": model_id,
        "system": [{"text": system}],
        "messages": [{"role": "user", "content": [{"guardContent": {"text": {"text": user_text}}}]}],
        "inferenceConfig": {"maxTokens": max_tokens, "temperature": temperature},
    }
    gc = _guardrail_config()
    if gc:
        kwargs["guardrailConfig"] = gc
    resp = _bedrock().converse(**kwargs)
    blocks = resp.get("output", {}).get("message", {}).get("content", [])
    text = "".join(b.get("text", "") for b in blocks).strip()
    return text, resp.get("stopReason"), resp.get("usage", {})


def _read_body(event):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    return json.loads(raw) if raw else {}


def _clean_text(data):
    text = (data.get("text") or "").strip()
    if len(text) < MIN_TEXT_CHARS:
        return None, error_response(400, f"'text' must be at least {MIN_TEXT_CHARS} characters")
    if len(text) > MAX_TEXT_CHARS:
        return None, error_response(400, f"'text' must be at most {MAX_TEXT_CHARS} characters")
    return text, None


# --------------------------------------------------------------------------
# validate: cheap adequacy check, brief feedback
# --------------------------------------------------------------------------
_VALIDATE_SYSTEM = (
    "You review short passages submitted to a K-12 reading app. Judge only "
    "whether the passage is adequate to publish as a children's reading passage: "
    "coherent, complete (not a fragment), age-appropriate, and free of obvious "
    "spelling or grammar errors. Reply with ONE short sentence of feedback (max "
    "20 words). Start the sentence with 'OK:' if it is adequate, or 'FIX:' if it "
    "needs changes. Be specific but extremely brief."
)


def _do_validate(text):
    try:
        feedback, stop, usage = _converse(
            VALIDATE_MODEL, _VALIDATE_SYSTEM, text, max_tokens=60
        )
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        logger.warning("validate converse failed: %s", code)
        return error_response(502, "AI validation is unavailable right now")

    if stop == "guardrail_intervened":
        logger.info("validate: guardrail blocked input")
        return json_response(200, {
            "ok": False,
            "feedback": "FIX: This text was flagged as not appropriate for a children's app.",
            "blocked": True,
        })

    ok = feedback.upper().startswith("OK")
    # Trim defensively in case the model ignored the length ask.
    brief = feedback.split("\n")[0][:160]
    logger.info("validate ok=%s tokens_in=%s tokens_out=%s",
                ok, usage.get("inputTokens"), usage.get("outputTokens"))
    return json_response(200, {"ok": ok, "feedback": brief})


# --------------------------------------------------------------------------
# autofill: structured metadata + vocabulary
# --------------------------------------------------------------------------
_AUTOFILL_SYSTEM = (
    "You extract catalog metadata and vocabulary for a K-12 reading passage. "
    "Return ONLY a JSON object, no prose, with keys: title (short, <=80 chars), "
    "language ('en-US' or 'es-US'), gradeBand (one of 'k2','35','68','912'), "
    "grade (a number 0-12, K=0), genre (one of 'fiction','nonfiction','poetry',"
    "'drama','other'), topic (2-4 words naming what the passage is about — "
    "ALWAYS provide a topic), notes (one short sentence of guidance "
    "for a human reviewer, <=160 chars), and vocabulary: an array of up to 6 "
    "notable words from the passage, each an object {word, pos, def, ex} where "
    "pos is the part of speech (e.g. 'noun','verb','adjective'), def is a short, "
    "kid-friendly definition at the passage's reading level, and ex is one "
    "example sentence using the word (you may reuse the sentence from the passage). "
    "Choose words a student at this grade would need help with. "
    "Base every value on the passage text. If unsure of a field, omit it."
)


# Friendly display name for the model that generated the draft, used as the
# reviewer attribution (so it reads "Created by Nova Lite (AI)" rather than a
# raw model id or an invented person's name).
def _model_display_name(model_id):
    mid = model_id.lower()
    if "nova-micro" in mid:
        return "Nova Micro"
    if "nova-lite" in mid:
        return "Nova Lite"
    if "nova-pro" in mid:
        return "Nova Pro"
    if "nova" in mid:
        return "Nova"
    if "haiku" in mid:
        return "Claude Haiku"
    if "sonnet" in mid:
        return "Claude Sonnet"
    if "claude" in mid:
        return "Claude"
    if "llama" in mid:
        return "Llama"
    return "AI model"


def _coerce_fields(obj):
    """Validate the model's JSON into the fields the form accepts. Unknown or
    out-of-range values are dropped rather than trusted."""
    fields = {}
    title = obj.get("title")
    if isinstance(title, str) and title.strip():
        fields["title"] = title.strip()[:80]
    lang = obj.get("language")
    if lang in ("en-US", "es-US"):
        fields["language"] = lang
    band = str(obj.get("gradeBand") or "")
    if band in BANDS:
        fields["gradeBand"] = band
    grade = obj.get("grade")
    if isinstance(grade, (int, float)) and 0 <= grade <= 12:
        fields["grade"] = "K" if int(grade) == 0 else str(int(grade))
    genre = obj.get("genre")
    if genre in GENRES:
        fields["genre"] = genre
    topic = obj.get("topic")
    if isinstance(topic, str) and topic.strip():
        fields["topic"] = topic.strip()[:60]
    notes = obj.get("notes")
    if isinstance(notes, str) and notes.strip():
        fields["notes"] = notes.strip()[:160]

    cards = _coerce_vocab(obj.get("vocabulary"))
    return fields, cards


def _coerce_vocab(raw):
    """Validate the model's vocabulary into a list of review-ready cards:
    {word, pos, def, ex}. Accepts either objects (preferred) or bare strings
    (wrapped as {word}). Drops malformed/empty entries, de-dupes by word,
    caps length. pos/def/ex are optional so a partial card still shows."""
    cards, seen = [], set()
    for item in raw or []:
        if isinstance(item, str):
            item = {"word": item}
        if not isinstance(item, dict):
            continue
        # Allow accented letters / ñ so Spanish words survive; lowercase for the key.
        word = re.sub(r"[^\w'’-]", "", str(item.get("word", "")), flags=re.UNICODE).strip("-'’").lower()
        if not (2 < len(word) <= 30) or word in seen:
            continue
        seen.add(word)
        card = {"word": word}
        pos = item.get("pos")
        if isinstance(pos, str) and pos.strip():
            card["pos"] = pos.strip()[:20].lower()
        definition = item.get("def")
        if isinstance(definition, str) and definition.strip():
            card["def"] = definition.strip()[:300]
        example = item.get("ex")
        if isinstance(example, str) and example.strip():
            card["ex"] = example.strip()[:300]
        cards.append(card)
        if len(cards) >= 6:
            break
    return cards


_TOPIC_STOP = {
    "the", "and", "for", "that", "this", "with", "from", "they", "them", "their",
    "about", "into", "over", "your", "you", "are", "was", "were", "has", "have",
    "had", "but", "not", "can", "will", "would", "when", "where", "which", "what",
    "a", "an", "of", "to", "in", "is", "it", "on", "as", "at", "by", "or", "be",
}


def _topic_from_text(text):
    """A short topic guess from the passage: the most frequent meaningful words.
    Only a fallback for when the model omits topic."""
    words = re.findall(r"[A-Za-z][A-Za-z'’-]{3,}", text.lower())
    freq = {}
    for w in words:
        if w in _TOPIC_STOP:
            continue
        freq[w] = freq.get(w, 0) + 1
    top = sorted(freq, key=lambda w: (-freq[w], w))[:2]
    return " ".join(w.capitalize() for w in top) or "General"


def _extract_json(text):
    """The first JSON object in the model output (tolerates code fences / prose)."""
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _do_autofill(text):
    try:
        out, stop, usage = _converse(
            AUTOFILL_MODEL, _AUTOFILL_SYSTEM, text, max_tokens=300
        )
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        logger.warning("autofill converse failed: %s", code)
        return error_response(502, "AI autofill is unavailable right now")

    if stop == "guardrail_intervened":
        logger.info("autofill: guardrail blocked content")
        return json_response(200, {"fields": {}, "vocabulary": [], "blocked": True})

    obj = _extract_json(out)
    if obj is None:
        logger.warning("autofill: could not parse model JSON")
        return json_response(200, {"fields": {}, "vocabulary": []})

    fields, vocab = _coerce_fields(obj)

    # Topic must always be present (the model sometimes omits it). Fall back to
    # the title, else the most salient words of the passage, so the field is
    # never left blank.
    if not fields.get("topic"):
        fields["topic"] = fields.get("title") or _topic_from_text(text)

    # --- fields derived here, not from the model ---------------------------
    # Reviewer attribution: name the AI model that drafted this, so it's clear
    # a human still needs to review (never an invented person's name).
    attribution = f"Created by {_model_display_name(AUTOFILL_MODEL)} (AI)"
    fields["reviewer"] = attribution
    # Spanish reviewer gets the same model attribution (a Spanish version is
    # produced/reviewed by the same AI until a human reviewer is assigned).
    fields["spanishReviewer"] = attribution

    # A tidy, human-overridable batch label from the topic/title + today.
    slug_src = fields.get("topic") or fields.get("title") or "passage"
    slug = re.sub(r"[^a-z0-9]+", "-", slug_src.lower()).strip("-")[:30] or "passage"
    fields["batchLabel"] = f"ai-{slug}-{_today()}"

    # Workflow defaults (static, not AI guesses): stay in draft, review in 5 days.
    fields["afterApproval"] = "draft"
    fields["reviewBy"] = _days_from_today(5)

    logger.info("autofill fields=%s cards=%d tokens_in=%s tokens_out=%s",
                sorted(fields), len(vocab),
                usage.get("inputTokens"), usage.get("outputTokens"))
    return json_response(200, {"fields": fields, "vocabulary": vocab})


# --------------------------------------------------------------------------
# translate: English passage (+ vocab cards) -> Spanish, for the es sibling
# --------------------------------------------------------------------------
_TRANSLATE_SYSTEM = (
    "You translate a children's reading passage from English to Latin American "
    "Spanish (es-US), at the same reading level, preserving paragraph breaks and "
    "meaning. Keep it natural and age-appropriate. Return ONLY a JSON object with "
    "keys: text (the Spanish translation of the passage), title (Spanish title), "
    "and vocabulary. For vocabulary you are GIVEN a list of English cards; "
    "produce the Spanish version one-to-one, same order and same count — do not "
    "add, drop, or reorder any. For each card, set `word` to the Spanish "
    "translation EXACTLY AS THAT WORD APPEARS IN YOUR SPANISH `text` ABOVE "
    "(the same surface form, including any plural or conjugated ending and "
    "matching letters/accents) so the word can be found in the passage; if the "
    "concept is not present in the passage, use its most natural Spanish form. "
    "Also translate pos, def and ex to Spanish. Do not add commentary."
)


def _norm_word(w):
    """Match engine.js keyFor()/normWord(): lowercase, strip accents and
    non-alphanumerics, so a card word and a passage word compare equal."""
    import unicodedata
    stripped = "".join(c for c in unicodedata.normalize("NFD", (w or "").lower())
                        if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", stripped)


def _passage_word_set(text):
    return {_norm_word(w) for w in re.findall(r"\S+", text or "")}


_SENSE_SYSTEM = (
    "You check Spanish vocabulary word choices for a children's reading passage. "
    "You get the Spanish passage, and a list of items each with: en (the English "
    "word), def (its English meaning), and es (a candidate Spanish word). For each "
    "item, decide whether `es` is the correct Spanish word for that MEANING. If it "
    "is wrong (wrong sense), replace it with the correct Spanish word — but it MUST "
    "be a word that actually appears in the Spanish passage, in that exact surface "
    "form. If no word in the passage carries that meaning, keep the candidate. "
    "Return ONLY a JSON array of the corrected Spanish words (strings), same order "
    "and same count as the input. No commentary."
)


def _sense_check_vocab(en_cards, es_cards, es_text):
    """Second, cheap pass: correct any Spanish vocab word that's the wrong sense,
    keeping it a word that's present in the passage. Falls back to the first-pass
    word on any problem, so this can only improve or no-op — never breaks."""
    n = min(len(en_cards), len(es_cards))
    items = [{"en": en_cards[i].get("word", ""),
              "def": en_cards[i].get("def", ""),
              "es": es_cards[i].get("word", "")} for i in range(n)]
    user = "Spanish passage:\n" + es_text + "\n\nItems:\n" + json.dumps(items, ensure_ascii=False)
    try:
        out, stop, _ = _converse(AUTOFILL_MODEL, _SENSE_SYSTEM, user, max_tokens=200)
    except ClientError:
        return es_cards  # best effort: keep first-pass words
    if stop == "guardrail_intervened":
        return es_cards

    m = re.search(r"\[.*\]", out, re.DOTALL)
    corrected = None
    if m:
        try:
            parsed = json.loads(m.group(0))
            if isinstance(parsed, list):
                corrected = parsed
        except json.JSONDecodeError:
            corrected = None

    passage = _passage_word_set(es_text)
    passage_list = [_norm_word(w) for w in re.findall(r"\S+", es_text or "")]
    out_cards = [dict(c) for c in es_cards]
    changed = 0
    for i in range(n):
        # 1) Apply a sense correction when it's a real change AND the corrected
        #    word appears in the passage (so it still underlines).
        if corrected and i < len(corrected):
            new_word = str(corrected[i] or "").strip()
            if new_word and _norm_word(new_word) != _norm_word(out_cards[i]["word"]) \
                    and _norm_word(new_word) in passage:
                out_cards[i]["word"] = new_word
                changed += 1
        # 2) Surface-form repair: if the (possibly corrected) word still isn't
        #    in the passage, map it to a passage word sharing its stem — e.g.
        #    "lujo" -> "lujosas" — so it underlines. Keeps meaning, fixes form.
        if _norm_word(out_cards[i]["word"]) not in passage:
            match = _stem_match(_norm_word(out_cards[i]["word"]), passage_list)
            if match:
                # recover the original surface form (with accents/case) for display
                out_cards[i]["word"] = _surface_form(match, es_text) or out_cards[i]["word"]
                changed += 1
    if changed:
        logger.info("sense-check adjusted %d/%d vocab words", changed, n)
    return out_cards


def _stem_match(norm_word, passage_norm_words):
    """A passage word sharing a 4+ char stem with norm_word (both directions),
    for Spanish inflection (lujo/lujosas, brillar/brillan). None if no match."""
    if len(norm_word) < 4:
        return None
    stem = norm_word[:max(4, len(norm_word) - 3)]
    best = None
    for pw in passage_norm_words:
        if len(pw) < 4:
            continue
        if pw.startswith(stem) or norm_word.startswith(pw[:max(4, len(pw) - 3)]):
            if best is None or abs(len(pw) - len(norm_word)) < abs(len(best) - len(norm_word)):
                best = pw
    return best


def _surface_form(norm_target, es_text):
    """The original (accented/cased) passage token whose normalized form equals
    norm_target, so the card shows the real word, not the stripped key."""
    for tok in re.findall(r"\S+", es_text or ""):
        cleaned = tok.strip(".,;:!?\"'“”¿¡()[]…—–")
        if _norm_word(cleaned) == norm_target:
            return cleaned
    return None


def _do_translate(text, vocab_cards):
    # Give the model the vocabulary to translate alongside the passage, so the
    # Spanish cards line up with the Spanish text in one call.
    cards_in = _coerce_vocab(vocab_cards)
    user = text
    if cards_in:
        user = text + "\n\n---\nVOCABULARY (translate each, keep order):\n" + json.dumps(cards_in, ensure_ascii=False)
    try:
        out, stop, usage = _converse(AUTOFILL_MODEL, _TRANSLATE_SYSTEM, user, max_tokens=1500)
    except ClientError as e:
        logger.warning("translate converse failed: %s", e.response.get("Error", {}).get("Code", ""))
        return error_response(502, "AI translation is unavailable right now")

    if stop == "guardrail_intervened":
        logger.info("translate: guardrail blocked content")
        return json_response(200, {"blocked": True})

    obj = _extract_json(out)
    if not obj or not isinstance(obj.get("text"), str) or not obj["text"].strip():
        logger.warning("translate: could not parse model JSON / empty text")
        return error_response(502, "AI translation produced no usable output")

    es_text = obj["text"].strip()[:MAX_TEXT_CHARS]
    es_cards = _coerce_vocab(obj.get("vocabulary"))
    # Sense pass: make sure each Spanish vocab word is the right MEANING of the
    # English word (not just any word that happens to be in the passage) while
    # still being a word that appears in the Spanish text. Only runs when there
    # were input cards.
    if cards_in and es_cards:
        es_cards = _sense_check_vocab(cards_in, es_cards, es_text)

    result = {
        "text": es_text,
        "title": (obj.get("title") or "").strip()[:200] or None,
        "vocabularyCards": es_cards,
        "model": _model_display_name(AUTOFILL_MODEL),
    }
    logger.info("translate chars_in=%d chars_out=%d cards=%d tokens_in=%s tokens_out=%s",
                len(text), len(result["text"]), len(result["vocabularyCards"]),
                usage.get("inputTokens"), usage.get("outputTokens"))
    return json_response(200, result)


def handler(event, context):
    try:
        data = _read_body(event)
    except (ValueError, UnicodeDecodeError):
        return error_response(400, "Body must be valid JSON")

    mode = (data.get("mode") or "validate").strip().lower()
    if mode not in ("validate", "autofill", "translate"):
        return error_response(400, "'mode' must be 'validate', 'autofill' or 'translate'")

    text, err = _clean_text(data)
    if err:
        return err

    if mode == "validate":
        return _do_validate(text)
    if mode == "autofill":
        return _do_autofill(text)
    return _do_translate(text, data.get("vocabularyCards"))
