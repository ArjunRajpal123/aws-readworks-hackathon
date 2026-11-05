#!/usr/bin/env python3
"""One-time migration: load the built-in frontend content into the cloud.

Input is the JSON emitted by frontend/scripts/export_content.mjs (the app's
own assembled MODES + CATALOG + CARDS, so the cloud copy is byte-identical to
what the frontend shipped). Each player mode becomes a `content#<modeId>`
item; the catalog and the shared CARDS map are single index items. After this,
the player reads passages, cards, Word Stops and questions from the data API
and the data_*.js files can be deleted.

Schema (reference table, single-table, typed ids):
    content#<modeId>   one playable passage/mode:
        {id, band, lang, title, tab, sub, voice, reward, stopTitle, how,
         audio, rwf, gen, details, paras, stops, forms, cardOverride,
         questions, pid, modes{en,es}, grade, genre, lexile, tags, words, url}
    catalog#index      {entries: [catalog entry, ...]}  (list/tab/next metadata)
    cards#index        {cards: {key: card, ...}}         (shared vocab cards)

Idempotent and additive: stable ids, re-running overwrites. Does NOT touch the
pipeline passage product records (sa/product/<id>, keyed by bare id).

    uv run --with boto3 python lambda/scripts/seed_content.py --content /tmp/sa-content.json --apply
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import boto3

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import data_store as db  # noqa: E402

DEFAULT_STACK = "rg-readworks-bb-storage"


def seed(content, apply):
    modes = content["modes"]
    catalog = content["catalog"]
    cards = content["cards"]

    # Link each mode to its catalog entry (pid + metadata) so a single
    # content#<id> item has everything the player and lists need.
    by_en = {e["modes"]["en"]: e for e in catalog}
    by_es = {e["modes"]["es"]: e for e in catalog if e.get("modes", {}).get("es")}

    counts = {"content": 0, "catalog": 0, "cards": 0}

    def w(kind, item_id, body):
        counts[kind] += 1
        if apply:
            db.put(kind, item_id, body)

    for m in modes:
        entry = by_en.get(m["id"]) or by_es.get(m["id"]) or {}
        body = dict(m)
        body["pid"] = entry.get("pid")
        body["modes"] = entry.get("modes")
        for k in ("grade", "genre", "lexile", "tags", "words", "url"):
            if entry.get(k) is not None:
                body[k] = entry[k]
        w("content", m["id"], body)

    w("catalog", "index", {"entries": catalog})
    w("cards", "index", {"cards": cards})

    print(("APPLIED" if apply else "DRY RUN"))
    for k, v in counts.items():
        print(f"  {k:8} {v}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Seed built-in content into the reference table.")
    ap.add_argument("--content", required=True, help="JSON from export_content.mjs")
    ap.add_argument("--table", help="DynamoDB table (default: resolve from storage stack)")
    ap.add_argument("--stack", default=DEFAULT_STACK)
    ap.add_argument("--region", default="us-west-2")
    ap.add_argument("--apply", action="store_true", help="write to DynamoDB (default: dry run)")
    args = ap.parse_args(argv)

    os.environ.setdefault("AWS_DEFAULT_REGION", args.region)
    table = args.table
    if not table and args.apply:
        cfn = boto3.client("cloudformation", region_name=args.region)
        outs = cfn.describe_stacks(StackName=args.stack)["Stacks"][0]["Outputs"]
        table = next(o["OutputValue"] for o in outs if o["OutputKey"] == "ReferenceTableName")
    if table:
        os.environ["TTS_REFERENCE_TABLE"] = table
        db._table = boto3.resource("dynamodb", region_name=args.region).Table(table)

    content = json.loads(Path(args.content).read_text(encoding="utf-8"))
    seed(content, args.apply)
    return 0


if __name__ == "__main__":
    sys.exit(main())
