"""P1 — Ingest and tokenize (no AI).

Turns raw passage text into the token structure the player renders and the
alignment step maps onto:

  - whitespace word tokens, numbered, wrapped in <span data-w="i">
  - sentence and paragraph start indices
  - a textHash over the token list (stable id; unchanged hash => skip downstream)

The player (frontend/src/engine.js) renders `contentTokenized` and highlights
by index, and ignores a timing file whose textHash does not match. So the hash
must be computed the same way wherever it runs.

Pinned per language: sa-tok-en-1.0 / sa-tok-es-1.0.
"""

from __future__ import annotations

import hashlib
import html
import re
from dataclasses import dataclass, field
from typing import List

TOKENIZER_VERSION = {
    "en": "sa-tok-en-1.0",
    "es": "sa-tok-es-1.0",
}

# A token boundary is whitespace. We keep punctuation attached to the word,
# matching how Polly emits one speech mark per whitespace-delimited word
# (punctuation is not its own mark). Spanish keeps ¿ ¡ « » and accents attached.
_WS = re.compile(r"\s+")

# Sentence-final punctuation, allowing trailing closing quotes/brackets.
_SENT_END = re.compile(r"[.!?][\"'\u201d\u2019\u00bb)\]]*$")


@dataclass
class Token:
    i: int
    text: str
    para: int  # paragraph index
    sentence: int  # sentence index (across the whole passage)


@dataclass
class Tokenized:
    lang: str
    tokenizer_version: str
    tokens: List[Token]
    paragraph_starts: List[int]  # token index starting each paragraph
    sentence_starts: List[int]  # token index starting each sentence
    content_tokenized: str  # HTML: numbered <span data-w="i"> per word
    text_hash: str

    @property
    def token_count(self) -> int:
        return len(self.tokens)


def _normalize_paragraphs(text: str) -> List[str]:
    """Split into non-empty paragraphs on blank lines or single newlines."""
    # Accept either blank-line or single-newline separated paragraphs.
    parts = re.split(r"\n\s*\n|\n", text.strip())
    return [p.strip() for p in parts if p.strip()]


def tokenize(text: str, lang: str = "en") -> Tokenized:
    """Tokenize passage text into the Sound Along token structure."""
    lang = (lang or "en").lower()[:2]
    tok_version = TOKENIZER_VERSION.get(lang, TOKENIZER_VERSION["en"])

    paragraphs = _normalize_paragraphs(text)

    tokens: List[Token] = []
    paragraph_starts: List[int] = []
    sentence_starts: List[int] = []

    sentence = 0
    sentence_open = False

    for p_index, para in enumerate(paragraphs):
        paragraph_starts.append(len(tokens))
        # New paragraph always starts a new sentence.
        if sentence_open:
            sentence += 1
            sentence_open = False

        words = [w for w in _WS.split(para) if w]
        for w in words:
            if not sentence_open:
                sentence_starts.append(len(tokens))
                sentence_open = True
            tokens.append(
                Token(i=len(tokens), text=w, para=p_index, sentence=sentence)
            )
            if _SENT_END.search(w):
                sentence += 1
                sentence_open = False

    content_tokenized = _render_html(tokens, paragraphs)
    text_hash = compute_text_hash(tokens, lang, tok_version)

    return Tokenized(
        lang=lang,
        tokenizer_version=tok_version,
        tokens=tokens,
        paragraph_starts=paragraph_starts,
        sentence_starts=sentence_starts,
        content_tokenized=content_tokenized,
        text_hash=text_hash,
    )


def _render_html(tokens: List[Token], paragraphs: List[str]) -> str:
    """Render numbered word spans grouped by paragraph.

    <p><span data-w="0">In</span> <span data-w="1">a</span> ...</p>
    """
    by_para: dict[int, List[Token]] = {}
    for t in tokens:
        by_para.setdefault(t.para, []).append(t)

    out = []
    for p_index in range(len(paragraphs)):
        spans = [
            f'<span data-w="{t.i}">{html.escape(t.text)}</span>'
            for t in by_para.get(p_index, [])
        ]
        out.append("<p>" + " ".join(spans) + "</p>")
    return "".join(out)


def compute_text_hash(tokens: List[Token], lang: str, tok_version: str) -> str:
    """Stable hash over the token list + tokenizer identity.

    Any change to the token text, order, language, or tokenizer version
    changes the hash, which forces regeneration downstream. Unchanged text
    yields the same hash, so the pipeline can skip and incur no cost.
    """
    h = hashlib.sha256()
    h.update(tok_version.encode("utf-8"))
    h.update(b"\x00")
    h.update(lang.encode("utf-8"))
    h.update(b"\x00")
    for t in tokens:
        h.update(t.text.encode("utf-8"))
        h.update(b"\x1f")  # unit separator between tokens
    return "sha256:" + h.hexdigest()
