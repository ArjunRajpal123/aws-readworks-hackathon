"""ETL runner backed by the deployed /api/v1/text-to-speech Lambda API,
instead of calling Amazon Polly directly like run_local.py/run_aws.py do.

Still runs the local tokenizer (P1) for contentTokenized/structure/vocab
anchors -- the API only produces its own flat word list -- then reuses the
existing audio.build_timing() byte-offset mapping (via api_client.synthesize,
a drop-in replacement for audio.synthesize()) to build the same
frontend/public/sa/ output as run_local.py, so the player needs no changes.

Usage:
    python run_api.py inputs/e1-p1.json --api-url https://xxxx.execute-api.us-west-2.amazonaws.com
"""

from __future__ import annotations

import argparse
import functools
import json
import sys
from pathlib import Path

import api_client
from pipeline import PassageInput, run
from storage import LocalStorage

DEFAULT_SA_DIR = str(Path(__file__).resolve().parent.parent / "frontend" / "public" / "sa")

# Polly LanguageCode per 2-letter lang, matching the voices in audio.VOICE_BY_LANG.
LANGUAGE_CODE_BY_LANG = {"en": "en-US", "es": "es-US"}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Run the Sound Along ETL via the deployed text-to-speech API."
    )
    ap.add_argument("input", help="passage input JSON: {id, lang, title, text}")
    ap.add_argument(
        "--api-url",
        required=True,
        help="API Gateway base URL, e.g. https://xxxx.execute-api.us-west-2.amazonaws.com",
    )
    ap.add_argument(
        "--sa-dir",
        default=DEFAULT_SA_DIR,
        help="output sa/ directory (default: frontend/public/sa)",
    )
    args = ap.parse_args(argv)

    data = json.loads(Path(args.input).read_text(encoding="utf-8"))
    passage = PassageInput(
        id=data["id"],
        lang=data.get("lang", "en"),
        title=data.get("title", data["id"]),
        text=data["text"],
    )

    lang2 = (passage.lang or "en").lower()[:2]
    language_code = LANGUAGE_CODE_BY_LANG.get(lang2, LANGUAGE_CODE_BY_LANG["en"])
    synthesize_fn = functools.partial(api_client.synthesize, args.api_url, language_code)
    storage = LocalStorage(args.sa_dir)

    result = run(passage, synthesize_fn, storage)
    print(json.dumps(result, indent=2))
    print(f"\nWrote output under: {args.sa_dir}")
    print(f"Open the player at: .../proxy/5173/?m={passage.id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
