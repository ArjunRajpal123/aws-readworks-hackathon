"""Local-first ETL runner.

Reads one or more passage input JSONs, runs P1+P3 with real Polly (your AWS
creds), and writes the player-facing output under frontend/public/sa/ so the
running Vite app can play real audio. Also builds sa/review.html, a page to
listen to and check every passage.

Usage:
    python run_local.py inputs/e1-p1.json
    python run_local.py inputs/rws-*.json --profile hackathon
    python run_local.py inputs/e1-p1.json --sa-dir ../frontend/public/sa
"""

from __future__ import annotations

import argparse
import glob
import json
import sys
from pathlib import Path

import boto3

from audio import ensure_lexicons
from pipeline import PassageInput, run
from review import build_review
from storage import LocalStorage
from voices import load_voices

DEFAULT_SA_DIR = str(Path(__file__).resolve().parent.parent / "frontend" / "public" / "sa")


def _expand(patterns: list[str]) -> list[str]:
    """Expand globs ourselves so `inputs/rws-*.json` also works in PowerShell/cmd."""
    out: list[str] = []
    for p in patterns:
        out.extend(sorted(glob.glob(p)) or [p])
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Run the Sound Along ETL locally.")
    ap.add_argument("input", nargs="+", help="passage input JSON(s): {id, lang, title, text}")
    ap.add_argument("--sa-dir", default=DEFAULT_SA_DIR,
                    help="output sa/ directory (default: frontend/public/sa)")
    ap.add_argument("--region", default="us-west-2")
    ap.add_argument("--profile", default=None,
                    help="AWS CLI profile (default: the standard credential chain)")
    ap.add_argument("--no-lexicon", action="store_true",
                    help="skip uploading the pronunciation lexicons to Polly")
    ap.add_argument("--no-review", action="store_true", help="skip building review.html")
    args = ap.parse_args(argv)

    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    try:
        ident = session.client("sts").get_caller_identity()
    except Exception as exc:  # noqa: BLE001 - report and stop before any Polly call
        hint = f"aws login --profile {args.profile}" if args.profile else "aws login"
        print(f"AWS credentials not usable ({exc.__class__.__name__}: {exc}).\n"
              f"Sign in first, e.g.:  {hint}", file=sys.stderr)
        return 1
    print(f"AWS account {ident['Account']} as {ident['Arn']} ({args.region})")

    polly = session.client("polly")
    storage = LocalStorage(args.sa_dir)

    if not args.no_lexicon:
        names = ensure_lexicons(polly, load_voices())
        print(f"Lexicons uploaded: {', '.join(names) or 'none'}")

    results, failed = [], []
    for path in _expand(args.input):
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        passage = PassageInput(
            id=data["id"],
            lang=data.get("lang", "en"),
            title=data.get("title", data["id"]),
            text=data["text"],
            pronunciation=data.get("pronunciation"),
        )
        try:
            results.append(run(passage, polly, storage))
        except Exception as exc:  # noqa: BLE001 - keep going; report at the end
            failed.append((passage.id, f"{exc.__class__.__name__}: {exc}"))
            print(f"FAILED {passage.id}: {exc}", file=sys.stderr)

    if results:
        print(f"\n{'id':<14}{'voice':<7}{'qa':<10}{'words':>6}{'est.':>6}{'sent P/S':>10}{'secs':>7}{'cost $':>9}")
        for r in results:
            print(f"{r['id']:<14}{r['voiceId']:<7}{r['qa']:<10}{r['tokenCount']:>6}{r['lowConfidence']:>6}"
                  f"{str(r['pollySentences']) + '/' + str(r['ssmlSentences']):>10}"
                  f"{r['durationMs'] / 1000:>7.1f}{r['estCostUsd']:>9.4f}")
        print(f"Total estimated Polly cost: ${sum(r['estCostUsd'] for r in results):.4f}")
    print(f"\nWrote output under: {args.sa_dir}")
    if results and not args.no_review:
        review = build_review(args.sa_dir, [r["id"] for r in results])
        print(f"Review page: {review}")
    if results:
        print(f"Vue player: run `npm run dev` in frontend/, then open http://127.0.0.1:5173/?m={results[0]['id']}")
    for pid, err in failed:
        print(f"FAILED {pid}: {err}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
