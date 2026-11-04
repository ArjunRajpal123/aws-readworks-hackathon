"""Stage 2 (P3) voice configuration, loaded from voices.json.

Each language has shared naturalness settings and one or more voice tracks
(e.g. tts-1 female = default, tts-2 male). Voices are never chosen per
passage. `config_version` captures every setting that changes a track's
audio, so a settings change can be detected and regenerated.
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
    track_id: str = "tts-1"
    gender: str | None = None
    default: bool = True

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


def load_voice_tracks(path: Path | str | None = None) -> dict[str, list[VoiceConfig]]:
    """{lang: [VoiceConfig per track]}, default track first."""
    data = json.loads(Path(path or DEFAULT_VOICES_PATH).read_text(encoding="utf-8"))
    out: dict[str, list[VoiceConfig]] = {}
    for lang, v in data["voices"].items():
        # v1 files had a single top-level voiceId; treat it as one default track.
        tracks = v.get("tracks") or [{"id": "tts-1", "voiceId": v["voiceId"], "default": True}]
        if sum(bool(t.get("default")) for t in tracks) != 1:
            raise ValueError(f"voices.json: language {lang!r} needs exactly one default track")
        ids = [t["id"] for t in tracks]
        if len(set(ids)) != len(ids):
            raise ValueError(f"voices.json: language {lang!r} has duplicate track ids {ids}")
        tracks = sorted(tracks, key=lambda t: not t.get("default"))
        out[lang] = [
            VoiceConfig(
                lang=lang,
                language_code=v["languageCode"],
                engine=v["engine"],
                voice_id=t["voiceId"],
                ssml=bool(v.get("ssml", True)),
                rate=v.get("rate", "100%"),
                drc=bool(v.get("drc", False)),
                paragraph_break_ms=int(v.get("paragraphBreakMs", 0)),
                sample_rate=str(v.get("sampleRate", "24000")),
                lexicon_name=v.get("lexiconName"),
                lexicon_file=v.get("lexiconFile"),
                lexicon_revision=int(v.get("lexiconRevision", 0)),
                inline_lexicon=bool(v.get("inlineLexicon", False)),
                track_id=t["id"],
                gender=t.get("gender"),
                default=bool(t.get("default")),
            )
            for t in tracks
        ]
    return out


def load_voices(path: Path | str | None = None) -> dict[str, VoiceConfig]:
    """{lang: default-track VoiceConfig} (the voice the player plays first)."""
    return {lang: tracks[0] for lang, tracks in load_voice_tracks(path).items()}


def tracks_for(lang: str, path: Path | str | None = None) -> list[VoiceConfig]:
    all_tracks = load_voice_tracks(path)
    return all_tracks.get((lang or "en").lower()[:2], all_tracks["en"])


def voice_for(lang: str, voices: dict[str, VoiceConfig] | None = None) -> VoiceConfig:
    """Default-track voice for a language."""
    voices = voices or load_voices()
    return voices.get((lang or "en").lower()[:2], voices["en"])
