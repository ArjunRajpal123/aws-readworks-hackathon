"""Extract a passage from RW_Data.xlsx into the ETL input JSON format.

Reads the `Passages` sheet (openpyxl, data_only), finds a row by its xlsx ID
(e.g. "E1"), and writes the ETL input shape consumed by run_local.py / pipeline.py:

    { "id": str, "lang": "en"|"es", "title": str, "text": str }

`id` is the lowercased xlsx ID (e.g. "e1"). `title` is the Title column.
`text` is the full passage text, or — with --max-words — the first N whole
words (truncated at a sentence boundary at or before N words when possible).

Amazon Polly's synchronous synthesis caps at 3000 UTF-8 bytes. Several full
passages exceed this, so the printed byte count is checked and a WARNING is
emitted when it is over the cap. Use --max-words to trim a long passage to fit.

Usage:
    python extract_passage.py --id E1
    python extract_passage.py --id E1 --max-words 150
    python extract_passage.py --id E2 --max-words 400 --out inputs/e2.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import openpyxl

# Polly synchronous synthesize_speech caps at 3000 UTF-8 bytes.
POLLY_SYNC_BYTE_CAP = 3000

DEFAULT_XLSX = str(Path(__file__).resolve().parent.parent / "docs" / "RW_Data.xlsx")
INPUTS_DIR = Path(__file__).resolve().parent / "inputs"

PASSAGES_SHEET = "Passages"
ID_COL = "ID"
TITLE_COL = "Title"
TEXT_COL = "Full passage text"

# Sentence-ending punctuation, an optional closing quote/paren, then
# whitespace. The capturing group keeps the terminator attached to the
# sentence it ends when we rebuild the kept text. (Python's re requires a
# fixed-width lookbehind, so we capture-and-rejoin instead.)
_SENTENCE_END = re.compile(r'([.!?][)"\u201d\u2019]?)\s+')


def _split_sentences(text: str) -> list:
    """Split text into sentences, keeping terminating punctuation."""
    parts = _SENTENCE_END.split(text)
    sentences: list = []
    # parts = [body, term, body, term, ..., tail]
    for i in range(0, len(parts) - 1, 2):
        body = parts[i]
        term = parts[i + 1]
        sentences.append((body + term).strip())
    tail = parts[-1].strip() if len(parts) % 2 == 1 else ""
    if tail:
        sentences.append(tail)
    return [s for s in sentences if s]


def _column_index(header: list, name: str) -> int:
    for i, h in enumerate(header):
        if (h or "").strip() == name:
            return i
    raise KeyError(
        f"column {name!r} not found in {PASSAGES_SHEET} sheet; got {header!r}"
    )


def load_passage(xlsx_path: str, passage_id: str) -> tuple[str, str]:
    """Return (title, text) for the row whose ID matches passage_id.

    Matching is case-insensitive on a stripped ID.
    """
    wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    try:
        ws = wb[PASSAGES_SHEET]
    except KeyError:
        raise KeyError(
            f"sheet {PASSAGES_SHEET!r} not found; sheets: {wb.sheetnames}"
        )

    rows = ws.iter_rows(values_only=True)
    header = list(next(rows))
    id_i = _column_index(header, ID_COL)
    title_i = _column_index(header, TITLE_COL)
    text_i = _column_index(header, TEXT_COL)

    want = passage_id.strip().lower()
    for row in rows:
        raw_id = row[id_i]
        if raw_id is None:
            continue
        if str(raw_id).strip().lower() == want:
            title = (row[title_i] or "").strip()
            text = (row[text_i] or "").strip()
            return title, text

    raise KeyError(f"passage id {passage_id!r} not found in {PASSAGES_SHEET} sheet")


def truncate_to_words(text: str, max_words: int) -> str:
    """Truncate text to at most max_words whole words.

    Prefer ending on a sentence boundary at or before max_words. If no sentence
    boundary fits (e.g. the first sentence is longer than max_words), fall back
    to a hard word cut.
    """
    if max_words is None or max_words <= 0:
        return text
    if len(text.split()) <= max_words:
        return text

    # Try to keep whole sentences up to the word budget.
    sentences = _split_sentences(text)
    kept: list[str] = []
    count = 0
    for sent in sentences:
        n = len(sent.split())
        if count + n > max_words:
            break
        kept.append(sent)
        count += n

    if kept:
        return " ".join(kept).strip()

    # Fallback: first sentence alone already exceeds the budget -> hard cut.
    return " ".join(text.split()[:max_words]).strip()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Extract a passage from RW_Data.xlsx into ETL input JSON."
    )
    ap.add_argument("--id", required=True, help="xlsx passage ID, e.g. E1")
    ap.add_argument("--out", default=None,
                    help="output JSON path (default: inputs/<id-lowercased>.json)")
    ap.add_argument("--lang", default="en", help="language code (default: en)")
    ap.add_argument("--max-words", type=int, default=None,
                    help="truncate text to the first N whole words")
    ap.add_argument("--xlsx", default=DEFAULT_XLSX,
                    help=f"path to the xlsx (default: {DEFAULT_XLSX})")
    args = ap.parse_args(argv)

    title, text = load_passage(args.xlsx, args.id)

    if args.max_words is not None:
        text = truncate_to_words(text, args.max_words)

    out_id = args.id.strip().lower()
    out_path = Path(args.out) if args.out else INPUTS_DIR / f"{out_id}.json"

    record = {
        "id": out_id,
        "lang": args.lang,
        "title": title,
        "text": text,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    word_count = len(text.split())
    byte_count = len(text.encode("utf-8"))

    print(f"Wrote {out_path}")
    print(f"  id={out_id} lang={args.lang} title={title!r}")
    print(f"  words={word_count}  utf8_bytes={byte_count}")
    if byte_count > POLLY_SYNC_BYTE_CAP:
        over = byte_count - POLLY_SYNC_BYTE_CAP
        print(
            f"  WARNING: text is {byte_count} UTF-8 bytes, {over} over Polly's "
            f"{POLLY_SYNC_BYTE_CAP}-byte sync cap. Use --max-words to trim it.",
            file=sys.stderr,
        )
    else:
        print(f"  OK: under Polly's {POLLY_SYNC_BYTE_CAP}-byte sync cap.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
