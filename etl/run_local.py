"""Local-first ETL runner.

Reads a passage input JSON, runs P1+P3 with real Polly (your AWS creds), and
writes the player-facing output under frontend/public/sa/ so the running Vite
app can play real audio.

Usage:
    python run_local.py inputs/e1-p1.json
    python run_local.py inputs/e1-p1.json --sa-dir ../frontend/public/sa
"""

from __future__ import annotations

import argparse
import functools
import json
import sys
from pathlib import Path

import boto3

import audio as audio_mod
from pipeline import PassageInput, run
from storage import LocalStorage

DEFAULT_SA_DIR = str(Path(__file__).resolve().parent.parent / "frontend" / "public" / "sa")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Run the Sound Along ETL locally.")
    ap.add_argument("input", help="passage input JSON: {id, lang, title, text}")
    ap.add_argument("--sa-dir", default=DEFAULT_SA_DIR,
                    help="output sa/ directory (default: frontend/public/sa)")
    ap.add_argument("--region", default="us-west-2")
    args = ap.parse_args(argv)

    data = json.loads(Path(args.input).read_text(encoding="utf-8"))
    passage = PassageInput(
        id=data["id"],
        lang=data.get("lang", "en"),
        title=data.get("title", data["id"]),
        text=data["text"],
    )

    polly = boto3.client("polly", region_name=args.region)
    synthesize_fn = functools.partial(audio_mod.synthesize, polly)
    storage = LocalStorage(args.sa_dir)

    result = run(passage, synthesize_fn, storage)
    print(json.dumps(result, indent=2))
    print(f"\nWrote output under: {args.sa_dir}")
    print(f"Open the player at: .../proxy/5173/?m={passage.id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
