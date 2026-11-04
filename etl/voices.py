"""Stage 2 (P3) voice configuration, loaded from voices.json.

One voice and one set of naturalness settings per language, never chosen per
passage. `config_version` captures every setting that changes the audio, so a
settings change can be detected and regenerated.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

ETL_DIR = Path(__file__).resolve().parent
DEFAULT_VOICES_PATH = ETL_DIR / "voices.json"


@dataclass(frozen=True)
class VoiceConfig:
    lang: str  # 2-letter pipeline language: "en" | "es"
    language_code: str  # Polly / Transcribe code: "en-US" | "es-US"
    engine: str
    voice_id: str
    ssml: bool  # False = original plain-text request (no naturalness tags)
    rate: str  # <prosody rate>, e.g. "95%"
    drc: bool  # <amazon:effect name="drc">
    paragraph_break_ms: int  # extra <break> between paragraphs (0 = none)
    sample_rate: str
    lexicon_name: str | None
    lexicon_file: str | None  # relative to etl/
    lexicon_revision: int
    inline_lexicon: bool  # apply lexicon entries as inline SSML instead of LexiconNames

    @property
    def config_version(self) -> str:
        mode = "ssml" if self.ssml else "text"
        return (
            f"{self.language_code}/{self.engine}/{self.voice_id}/{mode}"
            f"/lex-{self.lexicon_revision}{'i' if self.inline_lexicon else ''}"
            f"/r{self.rate}/drc{int(self.drc)}/pb{self.paragraph_break_ms}"
        )

    @property
    def lexicon_path(self) -> Path | None:
        return ETL_DIR / self.lexicon_file if self.lexicon_file else None

    @property
    def lexicon_names(self) -> list[str]:
        """LexiconNames to send to Polly (none when applied inline)."""
        if self.lexicon_name and not self.inline_lexicon:
            return [self.lexicon_name]
        return []


def load_voices(path: Path | str | None = None) -> dict[str, VoiceConfig]:
    data = json.loads(Path(path or DEFAULT_VOICES_PATH).read_text(encoding="utf-8"))
    out: dict[str, VoiceConfig] = {}
    for lang, v in data["voices"].items():
        out[lang] = VoiceConfig(
            lang=lang,
            language_code=v["languageCode"],
            engine=v["engine"],
            voice_id=v["voiceId"],
            ssml=bool(v.get("ssml", True)),
            rate=v.get("rate", "100%"),
            drc=bool(v.get("drc", False)),
            paragraph_break_ms=int(v.get("paragraphBreakMs", 0)),
            sample_rate=str(v.get("sampleRate", "24000")),
            lexicon_name=v.get("lexiconName"),
            lexicon_file=v.get("lexiconFile"),
            lexicon_revision=int(v.get("lexiconRevision", 0)),
            inline_lexicon=bool(v.get("inlineLexicon", False)),
        )
    return out


def voice_for(lang: str, voices: dict[str, VoiceConfig] | None = None) -> VoiceConfig:
    voices = voices or load_voices()
    key = (lang or "en").lower()[:2]
    return voices.get(key, voices["en"])
