"""Golden-snapshot regression tests for the Sound Along pipeline output.

Runs pipeline.run() on every committed Stage 2 input (etl/inputs/rws-*.json)
with the deterministic FakePolly + in-memory storage, normalizes everything
the pipeline writes, and compares it to golden/<id>.json.

What a snapshot covers (the player/API contract, docs/baseref.txt):
  - the product record (runAt masked; it is a wall-clock timestamp)
  - every stored object: key, content type, encoding, and content
      *.json / *.json.gz  -> parsed JSON (gzip header mtime ignored)
      *.ssml / *.txt / *.jsonl -> text
      *.mp3               -> byte length + sha256
  - the run() summary the CLIs and the API return
  - the exact Polly requests (minus the text body, which is in *.input.*)

Any difference fails with a unified diff. If the change is intended, re-run
with --update-golden and commit the new snapshots with the code change.

Run:  .venv-etl/bin/python -m pytest .kiro/skills/regression-test/scripts -q
"""
from __future__ import annotations

import difflib
import gzip
import hashlib
import json
from pathlib import Path

import pytest

from fakes import FakePolly, FakeStorage
from pipeline import PassageInput, run

REPO = Path(__file__).resolve().parents[4]
INPUTS = sorted((REPO / "etl" / "inputs").glob("rws-*.json"))
GOLDEN = Path(__file__).parent / "golden"
MASK = "<masked>"


def _content(key: str, data: bytes, encoding: str | None):
    if encoding == "gzip" or key.endswith(".gz"):
        data = gzip.decompress(data)
        key = key[:-3]
    if key.endswith(".json"):
        return json.loads(data.decode("utf-8"))
    if key.endswith((".ssml", ".txt", ".jsonl")):
        return data.decode("utf-8")
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def _mask_run_at(product: dict) -> dict:
    product = json.loads(json.dumps(product))
    if "runAt" in product.get("generation", {}):
        product["generation"]["runAt"] = MASK
    return product


def snapshot(input_path: Path) -> dict:
    src = json.loads(input_path.read_text(encoding="utf-8"))
    passage = PassageInput(
        id=src["id"], lang=src["lang"], title=src["title"], text=src["text"],
        pronunciation=src.get("pronunciation"),
    )
    polly, storage = FakePolly(), FakeStorage()
    summary = run(passage, polly, storage)

    objects = {}
    for key in sorted(storage.objects):
        data, ctype, enc = storage.objects[key]
        content = _content(key, data, enc)
        if key.endswith(".soundAlong.json"):
            content = _mask_run_at(content)
        objects[key] = {"contentType": ctype, "encoding": enc, "content": content}

    requests = [{k: v for k, v in call.items() if k != "Text"} for call in polly.calls]
    return {
        "input": input_path.name,
        "summary": summary,
        "record": _mask_run_at(storage.records[passage.id]),
        "objects": objects,
        "pollyRequests": requests,
    }


def _dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def test_inputs_exist():
    assert INPUTS, "no etl/inputs/rws-*.json found; nothing to snapshot"


@pytest.mark.parametrize("input_path", INPUTS, ids=[p.stem for p in INPUTS])
def test_pipeline_output_matches_golden(input_path, request):
    actual = _dump(snapshot(input_path))
    golden = GOLDEN / f"{input_path.stem}.json"

    if request.config.getoption("--update-golden"):
        GOLDEN.mkdir(exist_ok=True)
        golden.write_text(actual, encoding="utf-8")
        pytest.skip(f"golden updated: {golden.relative_to(REPO)}")

    if not golden.exists():
        pytest.fail(f"missing golden {golden.relative_to(REPO)}; run with --update-golden")

    expected = golden.read_text(encoding="utf-8")
    if actual != expected:
        diff = "".join(difflib.unified_diff(
            expected.splitlines(keepends=True), actual.splitlines(keepends=True),
            fromfile=f"golden/{golden.name}", tofile="current", n=2,
        ))
        lines = diff.splitlines()
        shown = "\n".join(lines[:200])
        more = f"\n... {len(lines) - 200} more diff lines" if len(lines) > 200 else ""
        pytest.fail(f"pipeline output changed for {input_path.name}:\n{shown}{more}",
                    pytrace=False)


def test_no_orphan_goldens():
    """A golden without a matching input means an input was renamed or removed."""
    if not GOLDEN.exists():
        pytest.skip("no golden dir yet")
    stems = {p.stem for p in INPUTS}
    orphans = sorted(g.name for g in GOLDEN.glob("*.json") if g.stem not in stems)
    assert not orphans, f"golden files with no input: {orphans}"
