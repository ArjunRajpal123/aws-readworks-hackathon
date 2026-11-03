"""Dump the Vocabulary rows for a passage id as a JSON list.

Reads the `Vocabulary` sheet (openpyxl, data_only), selects rows whose ID
column matches the given passage id (e.g. "E1"), and writes:

    [ { "word", "pos", "definition", "example", "spanish", "synonyms" }, ... ]

to inputs/<id-lowercased>.vocab.json.

Usage:
    python extract_vocab.py --id E1
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import openpyxl

DEFAULT_XLSX = str(Path(__file__).resolve().parent.parent / "docs" / "RW_Data.xlsx")
INPUTS_DIR = Path(__file__).resolve().parent / "inputs"

VOCAB_SHEET = "Vocabulary"
COLS = {
    "id": "ID",
    "word": "Word",
    "pos": "Part of speech",
    "definition": "Definition",
    "example": "Example sentences (Wordsmyth)",
    "spanish": "Spanish",
    "synonyms": "Synonyms",
}


def _index(header: list, name: str) -> int:
    for i, h in enumerate(header):
        if (h or "").strip() == name:
            return i
    raise KeyError(f"column {name!r} not found in {VOCAB_SHEET} sheet; got {header!r}")


def load_vocab(xlsx_path: str, passage_id: str) -> list[dict]:
    wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    try:
        ws = wb[VOCAB_SHEET]
    except KeyError:
        raise KeyError(f"sheet {VOCAB_SHEET!r} not found; sheets: {wb.sheetnames}")

    rows = ws.iter_rows(values_only=True)
    header = list(next(rows))
    idx = {key: _index(header, col) for key, col in COLS.items()}

    want = passage_id.strip().lower()
    out: list[dict] = []
    for row in rows:
        raw_id = row[idx["id"]]
        if raw_id is None or str(raw_id).strip().lower() != want:
            continue

        def val(key: str):
            v = row[idx[key]]
            return v.strip() if isinstance(v, str) else v

        out.append({
            "word": val("word"),
            "pos": val("pos"),
            "definition": val("definition"),
            "example": val("example"),
            "spanish": val("spanish"),
            "synonyms": val("synonyms"),
        })
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Dump Vocabulary rows for a passage id as JSON."
    )
    ap.add_argument("--id", required=True, help="xlsx passage ID, e.g. E1")
    ap.add_argument("--out", default=None,
                    help="output path (default: inputs/<id-lowercased>.vocab.json)")
    ap.add_argument("--xlsx", default=DEFAULT_XLSX,
                    help=f"path to the xlsx (default: {DEFAULT_XLSX})")
    args = ap.parse_args(argv)

    vocab = load_vocab(args.xlsx, args.id)

    out_id = args.id.strip().lower()
    out_path = Path(args.out) if args.out else INPUTS_DIR / f"{out_id}.vocab.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(vocab, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(f"Wrote {out_path}")
    print(f"  id={out_id}  entries={len(vocab)}")
    if not vocab:
        print(f"  WARNING: no vocabulary rows matched id {args.id!r}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
