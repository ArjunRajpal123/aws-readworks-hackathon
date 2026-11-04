"""Extract the Stage 2 sample sentences (RW_Sentences.xlsx) into ETL inputs.

The workbook holds TTS edge-case sentences per ReadWorks passage (short,
complex, numbers, Mr./Mrs., dates) on two sheets: `Sentences` (English) and
`Spanish_MT` (machine-translated Spanish, not reviewed). Each row becomes one
ETL input JSON in the same shape extract_passage.py writes:

    { "id", "lang": "en"|"es", "title", "text", "source": {...} }

Each filled sentence cell becomes its own paragraph (blank line between), so
the shared tokenizer gives one paragraph per edge case. Cells marked
"NOT FOUND" / "N/A" are skipped; the Notes column is not read.

Output goes to etl/inputs/ (git-ignored: ReadWorks text stays out of this
public repo). Then run:  python run_local.py inputs/rws-*.json

Usage:
    python extract_sentences.py "<path>/RW_Sentences.xlsx"
    python extract_sentences.py "<path>/RW_Sentences.xlsx" --ids E1,E8 --lang en
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

import openpyxl

INPUTS_DIR = Path(__file__).resolve().parent / "inputs"
SKIP_PREFIXES = ("not found", "n/a")

# sheet -> (lang, title column, [(column, edge-case label)])
SHEETS = {
    "Sentences": ("en", "Title", [
        ("Short simple sentence", "short"),
        ("Complex longer sentence", "complex"),
        ("Sentence with a number", "number"),
        ("Sentence with Mr./Mrs. (English only)", "title_abbrev"),
        ("Sentence with a date/year", "date"),
    ]),
    "Spanish_MT": ("es", "Title (English source)", [
        ("Short simple sentence", "short"),
        ("Complex longer sentence", "complex"),
        ("Sentence with a number", "number"),
        ("Sentence with Sr./Sra. (from Mr./Mrs.)", "title_abbrev"),
        ("Sentence with a date/year", "date"),
    ]),
}


def clean(value) -> str:
    """NFC-normalize and collapse whitespace; curly quotes/accents kept as written."""
    if value is None:
        return ""
    return " ".join(unicodedata.normalize("NFC", str(value)).split())


def input_id(row_id: str, lang: str) -> str:
    return f"rws-{row_id.lower()}-{lang}"


def rows_to_inputs(wb, ids: set[str] | None = None, lang: str | None = None) -> list[dict]:
    out = []
    for sheet, (sheet_lang, title_col, columns) in SHEETS.items():
        if lang and lang != sheet_lang:
            continue
        if sheet not in wb.sheetnames:
            raise ValueError(f"workbook has no sheet {sheet!r}")
        rows = wb[sheet].iter_rows(values_only=True)
        header = [clean(h) for h in next(rows)]
        missing = [c for c, _ in columns if c not in header]
        if missing:
            raise ValueError(f"sheet {sheet!r} is missing column(s): {missing}")
        for values in rows:
            row = dict(zip(header, values))
            row_id = clean(row.get("ID"))
            if not row_id or (ids and row_id not in ids):
                continue
            paras, segments = [], []
            for col, label in columns:
                text = clean(row.get(col))
                if not text or text.lower().startswith(SKIP_PREFIXES):
                    continue
                segments.append({"paragraph": len(paras), "column": col, "case": label})
                paras.append(text)
            if not paras:
                continue
            out.append({
                "id": input_id(row_id, sheet_lang),
                "lang": sheet_lang,
                "title": f"{clean(row.get(title_col))} ({row_id}, {sheet_lang})",
                "text": "\n\n".join(paras),
                "source": {
                    "workbook": "RW_Sentences.xlsx",
                    "sheet": sheet,
                    "rowId": row_id,
                    "sourceUrl": clean(row.get("Source URL")),
                    "machineTranslated": sheet == "Spanish_MT",
                    "segments": segments,
                },
            })
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("xlsx", help="path to RW_Sentences.xlsx")
    ap.add_argument("--out-dir", default=str(INPUTS_DIR), help="default: etl/inputs/")
    ap.add_argument("--ids", help="comma-separated row IDs, e.g. E1,E8")
    ap.add_argument("--lang", choices=["en", "es"], help="only this language")
    args = ap.parse_args(argv)

    ids = {i.strip().upper() for i in args.ids.split(",")} if args.ids else None
    wb = openpyxl.load_workbook(args.xlsx, data_only=True, read_only=True)
    inputs = rows_to_inputs(wb, ids=ids, lang=args.lang)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    total = 0
    for rec in inputs:
        path = out_dir / f"{rec['id']}.json"
        path.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        total += len(rec["text"])
        print(f"  {rec['id']:<12} {len(rec['source']['segments'])} sentences  {len(rec['text']):>4} chars  {rec['title']}")
    print(f"Wrote {len(inputs)} input(s), {total} characters, to {out_dir}")
    return 0 if inputs else 1


if __name__ == "__main__":
    sys.exit(main())
