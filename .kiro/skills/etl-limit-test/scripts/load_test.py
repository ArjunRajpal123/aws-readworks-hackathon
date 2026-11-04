"""Live load / throttle test for the deployed text-to-speech API.

COSTS MONEY: every request runs real Polly Neural (audio + speech marks, both
billed) and writes S3 objects plus a DynamoDB item. It is a dry run unless
--yes is given, and it refuses to exceed the hard caps below.

Every request uses id "lt-<runid>-<n>", so the run's output is easy to find
and delete afterwards (the script prints the prefix).

Usage:
    # plan + cost estimate only (no requests)
    python load_test.py --stack rg-readworks-bb-api --profile hackathon
    # send: ramp concurrency 1 -> 2 -> 5, 10 requests per step
    python load_test.py --url https://.../api/v1/text-to-speech \
        --ramp 1,2,5 --requests-per-step 10 --chars 300 --yes
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import time
import urllib.error
import urllib.request
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[3]
for _p in (_REPO / "etl", _REPO / "etl" / "tests", _HERE):
    sys.path.insert(0, str(_p))
from limit_helpers import spoken_text  # noqa: E402

MAX_TOTAL_REQUESTS = 200
MAX_CONCURRENCY = 25
MAX_CHARS = 3000
USD_PER_MCHAR = 16.0  # Polly Neural list price; audio and marks billed separately
CLIENT_TIMEOUT_S = 35  # API Gateway HTTP API cuts off at ~29-30 s


def resolve_url(stack: str, profile: str | None, region: str) -> str:
    import boto3

    cfn = boto3.Session(profile_name=profile, region_name=region).client("cloudformation")
    outs = cfn.describe_stacks(StackName=stack)["Stacks"][0].get("Outputs", [])
    for o in outs:
        if o["OutputKey"] == "ApiUrl":
            return o["OutputValue"]
    raise SystemExit(f"stack {stack} has no ApiUrl output")


def post(url: str, body: dict) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=CLIENT_TIMEOUT_S) as resp:
            status, text = resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        status, text = e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001 - timeouts, resets: record and continue
        status, text = 0, f"{e.__class__.__name__}: {e}"
    ms = (time.perf_counter() - t0) * 1000
    err = None
    if status != 201:
        try:
            err = json.loads(text).get("error") or json.loads(text).get("message")
        except Exception:  # noqa: BLE001
            err = text[:200]
    return {"status": status, "ms": ms, "error": err}


def pct(values, p):
    if not values:
        return None
    s = sorted(values)
    return s[min(len(s) - 1, max(0, math.ceil(p / 100 * len(s)) - 1))]


def classify(r) -> str:
    if r["status"] == 201:
        return "ok"
    e = (r["error"] or "")
    if "Throttl" in e or "Rate exceeded" in e or r["status"] == 429:
        return "throttled"
    if r["status"] in (503, 504) or "timed out" in e.lower() or "Timeout" in e:
        return "timeout"
    if r["status"] == 0:
        return "client-error"
    return f"http-{r['status']}"


def run_step(url, conc, n, text, lang, all_voices, run_id, offset):
    bodies = []
    for i in range(n):
        b = {"id": f"lt-{run_id}-{offset + i}", "text": text, "lang": lang,
             "title": f"load test {run_id}"}
        if all_voices:
            b["allVoices"] = True
        bodies.append(b)
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=conc) as ex:
        results = list(ex.map(lambda b: post(url, b), bodies))
    wall = time.perf_counter() - t0
    return results, wall


def summarize(conc, results, wall):
    kinds = Counter(classify(r) for r in results)
    ok_ms = [r["ms"] for r in results if r["status"] == 201]
    return {
        "concurrency": conc,
        "requests": len(results),
        "wallS": round(wall, 2),
        "okPerS": round(kinds["ok"] / wall, 2) if wall else None,
        "outcomes": dict(kinds),
        "errorRate": round(1 - kinds["ok"] / len(results), 3) if results else 0,
        "p50ms": round(statistics.median(ok_ms)) if ok_ms else None,
        "p95ms": round(pct(ok_ms, 95)) if ok_ms else None,
        "maxms": round(max(ok_ms)) if ok_ms else None,
        "sampleErrors": sorted({r["error"] for r in results if r["error"]})[:3],
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--url", help="full POST URL (.../api/v1/text-to-speech)")
    src.add_argument("--stack", help="API stack name, e.g. rg-readworks-bb-api (reads ApiUrl)")
    ap.add_argument("--profile")
    ap.add_argument("--region", default="us-west-2")
    ap.add_argument("--ramp", default="1,2,5", help="comma list of concurrency levels")
    ap.add_argument("--requests-per-step", type=int, default=10)
    ap.add_argument("--chars", type=int, default=300, help="spoken chars per request")
    ap.add_argument("--lang", default="en", choices=["en", "es"])
    ap.add_argument("--all-voices", action="store_true", help="2 tracks per request (2x cost)")
    ap.add_argument("--stop-error-rate", type=float, default=0.5,
                    help="stop ramping once a step's error rate reaches this")
    ap.add_argument("--report", help="write the JSON report here")
    ap.add_argument("--yes", action="store_true", help="actually send requests")
    args = ap.parse_args(argv)

    steps = [int(x) for x in args.ramp.split(",") if x.strip()]
    total = len(steps) * args.requests_per_step
    if not 1 <= args.chars <= MAX_CHARS:
        ap.error(f"--chars must be 1..{MAX_CHARS}")
    if total > MAX_TOTAL_REQUESTS or max(steps) > MAX_CONCURRENCY or min(steps) < 1:
        ap.error(f"hard caps: <= {MAX_TOTAL_REQUESTS} requests total, "
                 f"concurrency 1..{MAX_CONCURRENCY} (asked {total} requests, max {max(steps)})")

    tracks = 2 if args.all_voices else 1
    billed = total * tracks * 2 * args.chars
    cost = billed * USD_PER_MCHAR / 1_000_000
    url = args.url or resolve_url(args.stack, args.profile, args.region)
    run_id = uuid.uuid4().hex[:8]

    print(f"Target:      {url}")
    print(f"Plan:        concurrency {steps}, {args.requests_per_step} requests each = {total} requests")
    print(f"Payload:     {args.chars} spoken chars, lang {args.lang}, {tracks} track(s)/request")
    print(f"Polly calls: {total * tracks * 2}  (~{billed:,} billed chars, est. ${cost:.4f})")
    print(f"Writes:      S3 sa/audio/lt-{run_id}-*/, sa/product/lt-{run_id}-*.soundAlong.json, "
          f"DynamoDB ids lt-{run_id}-*")
    if not args.yes:
        print("\nDry run. Re-run with --yes to send the requests.")
        return 0

    text = spoken_text(args.chars, args.lang)
    report, offset = {"runId": run_id, "url": url, "chars": args.chars, "lang": args.lang,
                      "tracks": tracks, "estCostUsd": round(cost, 4), "steps": []}, 0
    for conc in steps:
        results, wall = run_step(url, conc, args.requests_per_step, text, args.lang,
                                 args.all_voices, run_id, offset)
        offset += len(results)
        s = summarize(conc, results, wall)
        report["steps"].append(s)
        print(json.dumps(s))
        if s["errorRate"] >= args.stop_error_rate:
            print(f"Stopping: error rate {s['errorRate']} >= {args.stop_error_rate}")
            break

    report["sent"] = offset
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Report: {args.report}")
    print(f"\nCleanup: objects under sa/audio/lt-{run_id}-*/ and sa/product/lt-{run_id}-*, "
          f"DynamoDB ids lt-{run_id}-0..{offset - 1}")
    failed = any(s["errorRate"] > 0 for s in report["steps"])
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
