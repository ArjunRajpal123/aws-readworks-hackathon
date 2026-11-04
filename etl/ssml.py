"""Stage 2 (P3) — SSML for natural-sounding Polly Neural speech.

Polly Neural cannot do emphasis, pitch, breaths or whispering. What it does
respond to is structure, punctuation, pauses, pace and pronunciation, so every
passage is wrapped as:

    <speak>[<amazon:effect name="drc">]<prosody rate="95%">
      <p><s>sentence one</s><s>sentence two?</s></p>[<break time="Nms"/>]<p>...</p>
    </prosody>[</amazon:effect>]</speak>

<p>/<s> come from the tokenizer's paragraph and sentence starts, so Polly
pauses and uses end-of-sentence intonation exactly where Stage 1 says (and
does not split on "Mr."). Punctuation stays on the tokens for intonation.

Polly reports speech-mark offsets as UTF-8 **byte** offsets into this exact
string (tags included), so we record each token's byte span while building it.
A token wrapped by a pronunciation override (<w>, <sub>, <phoneme>, <lang>,
<say-as>) gets the span of the whole wrapped element; Polly's mark for that
word falls inside it.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

from tokenizer import Tokenized
from voices import VoiceConfig

# Override kind -> (SSML tag, attribute the short JSON form maps to)
_TAGS = {
    "w": ("w", "role"),
    "sub": ("sub", "alias"),
    "phoneme": ("phoneme", None),
    "lang": ("lang", "xml:lang"),
    "sayAs": ("say-as", "interpret-as"),
}
_PUNCT = "\"'“”‘’«»¿¡()[].,;:!?…—–-"
_PLS_NS = "{http://www.w3.org/2005/01/pronunciation-lexicon}"
# Titles/abbreviations after which a tokenizer sentence break is not a real one
# (the shared tokenizer splits on any token ending in "."). Only affects what
# Polly hears; the tokenizer's sentenceStarts (used by the player) are untouched.
_NO_BREAK_AFTER = {
    "mr.", "mrs.", "ms.", "dr.", "prof.", "st.", "jr.", "sr.", "sra.", "srta.",
    "dra.", "lic.", "ud.", "uds.", "vs.", "etc.", "e.g.", "i.e.", "ee.",
}


def _is_false_sentence_break(prev_text: str, next_text: str) -> bool:
    """True when a tokenizer sentence start should not become an SSML <s> break."""
    prev = prev_text.lstrip(_PUNCT).lower()
    if prev in _NO_BREAK_AFTER:
        return True
    nxt = next_text.lstrip(_PUNCT)
    return bool(nxt) and nxt[0].islower()


@dataclass(frozen=True)
class Override:
    kind: str  # "w" | "sub" | "phoneme" | "lang" | "sayAs"
    attrs: dict = field(default_factory=dict)

    def wrap(self, inner: str) -> str:
        tag = _TAGS[self.kind][0]
        attrs = "".join(f" {k}={quoteattr(v)}" for k, v in self.attrs.items())
        return f"<{tag}{attrs}>{inner}</{tag}>"


@dataclass(frozen=True)
class SsmlDoc:
    text: str
    token_spans: list  # [(b0, b1)] UTF-8 byte span of each token in `text`
    plain_chars: int  # characters of spoken text (tokens + single spaces), no tags
    sentence_count: int = 0  # <s> elements emitted
    merged_breaks: tuple = ()  # tokenizer sentence starts not used as <s> breaks


def parse_overrides(data: dict | None, token_count: int) -> dict[int, Override]:
    """Parse the optional per-passage `pronunciation` map: {"<tokenIndex>": {...}}.

    Short forms: {"w": "amazon:VB"}, {"sub": "one half"}, {"lang": "en-US"},
    {"sayAs": "date", "format": "md"}, {"phoneme": {"alphabet": "ipa", "ph": "..."}}.
    """
    out: dict[int, Override] = {}
    for key, spec in (data or {}).items():
        i = int(key)
        if not 0 <= i < token_count:
            raise ValueError(f"pronunciation override index {i} out of range (0..{token_count - 1})")
        kinds = [k for k in spec if k in _TAGS]
        if len(kinds) != 1:
            raise ValueError(f"pronunciation override {i}: unknown or ambiguous kind in {spec!r}")
        kind = kinds[0]
        value = spec[kind]
        if kind == "phoneme":
            attrs = {"alphabet": value.get("alphabet", "ipa"), "ph": value["ph"]}
        else:
            attrs = {_TAGS[kind][1]: value}
            if kind == "sayAs" and "format" in spec:
                attrs["format"] = spec["format"]
        out[i] = Override(kind, attrs)
    return out


def load_inline_lexicon(pls_path: Path | str) -> dict[str, Override]:
    """Read a PLS lexicon into {grapheme: Override} for inline application."""
    root = ET.parse(pls_path).getroot()
    alphabet = root.get("alphabet", "ipa")
    out: dict[str, Override] = {}
    for lexeme in root.iter(f"{_PLS_NS}lexeme"):
        alias = lexeme.find(f"{_PLS_NS}alias")
        phoneme = lexeme.find(f"{_PLS_NS}phoneme")
        for g in lexeme.iter(f"{_PLS_NS}grapheme"):
            if alias is not None and alias.text:
                out[g.text.strip()] = Override("sub", {"alias": alias.text.strip()})
            elif phoneme is not None and phoneme.text:
                out[g.text.strip()] = Override(
                    "phoneme", {"alphabet": alphabet, "ph": phoneme.text.strip()}
                )
    return out


def build_ssml(
    tk: Tokenized,
    voice: VoiceConfig,
    overrides: dict[int, Override] | None = None,
    inline_lexicon: dict[str, Override] | None = None,
) -> SsmlDoc:
    overrides = overrides or {}
    inline_lexicon = inline_lexicon or {}
    p_starts = set(tk.paragraph_starts)
    s_starts = set(tk.sentence_starts)

    chunks: list[bytes] = []
    spans: list[tuple[int, int]] = []
    offset = 0

    def emit(s: str) -> None:
        nonlocal offset
        b = s.encode("utf-8")
        chunks.append(b)
        offset += len(b)

    emit("<speak>")
    if voice.drc:
        emit('<amazon:effect name="drc">')
    emit(f"<prosody rate={quoteattr(voice.rate)}>")

    in_p = in_s = False
    sentences = 0
    merged: list[int] = []
    toks = tk.tokens
    for t in toks:
        i = t.i
        if i in p_starts or not in_p:
            if in_s:
                emit("</s>")
                in_s = False
            if in_p:
                emit("</p>")
                if voice.paragraph_break_ms:
                    emit(f'<break time="{voice.paragraph_break_ms}ms"/>')
            emit("<p>")
            in_p = True
        new_sentence = not in_s or (
            i in s_starts and not _is_false_sentence_break(toks[i - 1].text, t.text)
        )
        if in_s and i in s_starts and not new_sentence:
            merged.append(i)
        if new_sentence:
            if in_s:
                emit("</s>")
            emit("<s>")
            in_s = True
            sentences += 1
        else:
            emit(" ")

        piece = escape(t.text)
        ov = overrides.get(i) or inline_lexicon.get(t.text.strip(_PUNCT))
        if ov is not None:
            piece = ov.wrap(piece)
        start = offset
        emit(piece)
        spans.append((start, offset))

    if in_s:
        emit("</s>")
    if in_p:
        emit("</p>")
    emit("</prosody>")
    if voice.drc:
        emit("</amazon:effect>")
    emit("</speak>")

    plain = " ".join(t.text for t in tk.tokens)
    return SsmlDoc(text=b"".join(chunks).decode("utf-8"), token_spans=spans,
                   plain_chars=len(plain), sentence_count=sentences,
                   merged_breaks=tuple(merged))
