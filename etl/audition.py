"""Voice audition: read the same passage with several Polly voices to compare by ear.

Uses the pipeline's tokenizer and SSML (same naturalness settings as
voices.json), one Polly call per voice (audio only, no speech marks). Writes
MP3s and an audition page under <sa-dir>/audition/.

Usage:
    python audition.py inputs/rws-e9-en.json --voices Danielle,Joanna,Salli,Ruth,Stephen,Gregory,Matthew --profile hackathon
    python audition.py inputs/rws-e9-es.json --voices Lupe,Pedro,Andres:es-MX --profile hackathon

A voice may carry its own language code after a colon (Andres:es-MX); the
pronunciation lexicon is only sent when the language code matches its file.
"""

from __future__ import annotations

import argparse
import html
import json
import sys
from dataclasses import replace
from pathlib import Path

import boto3

from ssml import build_ssml
from tokenizer import tokenize
from voices import voice_for

DEFAULT_SA_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public" / "sa"


def parse_voices(spec: str) -> list[tuple[str, str | None]]:
    out = []
    for item in spec.split(","):
        name, _, code = item.strip().partition(":")
        out.append((name, code or None))
    return out


def audition(polly, passage: dict, voices: list[tuple[str, str | None]], out_dir: Path) -> list[dict]:
    lang = passage.get("lang", "en")
    base = voice_for(lang)
    tk = tokenize(passage["text"], lang=lang)
    doc = build_ssml(tk, base)
    out_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for name, code in voices:
        v = replace(base, voice_id=name, language_code=code or base.language_code)
        req = {"Text": doc.text, "TextType": "ssml", "VoiceId": v.voice_id, "Engine": v.engine,
               "LanguageCode": v.language_code, "OutputFormat": "mp3", "SampleRate": v.sample_rate}
        if v.lexicon_names and v.language_code == base.language_code:
            req["LexiconNames"] = v.lexicon_names
        resp = polly.synthesize_speech(**req)
        fname = f"{passage['id']}-{name}.mp3"
        (out_dir / fname).write_bytes(resp["AudioStream"].read())
        results.append({"passage": passage["id"], "title": passage.get("title", passage["id"]),
                        "voice": name, "languageCode": v.language_code, "file": fname,
                        "chars": int(resp.get("RequestCharacters", 0))})
        print(f"  {name:<10} {v.language_code}  {fname}")
    return results


def write_page(out_dir: Path) -> Path:
    index = out_dir / "audition.json"
    items = json.loads(index.read_text(encoding="utf-8")) if index.exists() else []
    groups: dict[str, list[dict]] = {}
    for it in items:
        groups.setdefault(it["passage"], []).append(it)
    e = html.escape
    body = "".join(
        f"<section><h2>{e(rows[0]['title'])}</h2>"
        + "".join(f"<div class=row><b>{e(r['voice'])}</b> <span>{e(r['languageCode'])}</span>"
                  f"<audio controls preload=none src='{e(r['file'])}'></audio></div>" for r in rows)
        + "</section>"
        for rows in groups.values()
    )
    page = (
        "<!doctype html><html lang=en><head><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'><title>Voice Audition</title>"
        "<style>body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#f6f8f9;color:#17252b}"
        "@media(prefers-color-scheme:dark){body{background:#0f1618;color:#e2ebee}section{background:#162125!important;border-color:#2a3a3f!important}}"
        "main{max-width:820px;margin:0 auto;padding:16px}section{background:#fff;border:1px solid #d9e1e4;border-radius:10px;padding:12px 14px;margin:12px 0}"
        ".row{display:grid;grid-template-columns:90px 60px 1fr;align-items:center;gap:8px;margin:6px 0}audio{width:100%}"
        "span{color:#5a6b72;font-size:13px}</style></head><body><main><h1>Voice audition</h1>"
        "<p>Same text and naturalness settings (SSML pauses, 95% rate, DRC) for every voice. Pick the most human-sounding.</p>"
        f"{body}</main></body></html>"
    )
    out = out_dir / "audition.html"
    out.write_text(page, encoding="utf-8")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Audition Polly voices on one passage.")
    ap.add_argument("input", help="passage input JSON")
    ap.add_argument("--voices", required=True, help="comma-separated voice ids, e.g. Danielle,Stephen,Andres:es-MX")
    ap.add_argument("--sa-dir", default=str(DEFAULT_SA_DIR))
    ap.add_argument("--profile", default=None)
    ap.add_argument("--region", default="us-west-2")
    args = ap.parse_args(argv)

    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    passage = json.loads(Path(args.input).read_text(encoding="utf-8"))
    out_dir = Path(args.sa_dir) / "audition"
    results = audition(session.client("polly"), passage, parse_voices(args.voices), out_dir)

    index = out_dir / "audition.json"
    old = json.loads(index.read_text(encoding="utf-8")) if index.exists() else []
    keep = [o for o in old if (o["passage"], o["voice"]) not in {(r["passage"], r["voice"]) for r in results}]
    index.write_text(json.dumps(keep + results, ensure_ascii=False, indent=1), encoding="utf-8")
    chars = sum(r["chars"] for r in results)
    print(f"{len(results)} clip(s), {chars} billed chars (~${chars * 16 / 1e6:.3f}). Page: {write_page(out_dir)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
