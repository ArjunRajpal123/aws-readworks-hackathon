#!/usr/bin/env python3
"""Deterministic AWS cost estimate for the Sound Along architecture.

All arithmetic happens here, not in the agent's head. Inputs:
  assumptions.json  usage drivers (edit these)
  prices.json       on-demand list prices, us-west-2 (refresh with --refresh-prices)

Scenarios:
  current  what infra/cdk deploys today (StorageStack + ApiStack), ETL run from a laptop/CI,
           players fetch MP3s through API GET -> presigned S3 URLs.
  target   the full architecture in docs/SoundAlong-Kiro.md (Step Functions, Polly generative,
           WhisperX on Fargate, Bedrock Word Stops, CloudFront, EC2 content API, SQS backfill,
           observability, security baseline, Phase 4 analytics, CI/CD).

Each scenario reports a one-time catalog backfill and a steady-state monthly run rate.

Usage (repo root):
  .venv-etl/bin/python .kiro/skills/cost-estimate/scripts/estimate_cost.py
  ... --scenario target --format json
  ... --set traffic.weekly_plays=500000 --set churn.monthly_regen_share=0.05
  ... --refresh-prices          # read-only Price List API calls (us-east-1 endpoint), rewrites prices.json
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import math
import sys
from pathlib import Path
from typing import Dict, List, Optional

HERE = Path(__file__).resolve().parent
GIB = 1024 ** 3
WEEKS_PER_MONTH = 52.0 / 12.0


# ---------------------------------------------------------------- inputs
def load_json(name: str) -> dict:
    return json.loads((HERE / name).read_text())


def apply_overrides(a: dict, sets: List[str]) -> None:
    for s in sets:
        path, _, raw = s.partition("=")
        if not raw:
            sys.exit(f"--set needs key.path=value, got {s!r}")
        node = a
        keys = path.split(".")
        for k in keys[:-1]:
            node = node[k]
        if keys[-1] not in node:
            sys.exit(f"--set: unknown key {path!r}")
        node[keys[-1]] = json.loads(raw) if raw[0] in "[{\"0123456789-tfn" else raw


# ---------------------------------------------------------------- pricing
class Prices:
    def __init__(self, data: dict):
        self.p = data["prices"]
        self.fetched = data.get("_fetched", "?")

    def cost(self, key: str, qty: float) -> float:
        """Tiered cost of qty units (tiers apply to this quantity alone)."""
        tiers = sorted(self.p[key]["tiers"], key=lambda t: t[0])
        total = 0.0
        for i, (begin, price) in enumerate(tiers):
            end = tiers[i + 1][0] if i + 1 < len(tiers) else math.inf
            if qty <= begin:
                break
            total += (min(qty, end) - begin) * price
        return total

    def unit(self, key: str) -> str:
        return self.p[key]["unit"]


class Ledger:
    def __init__(self, prices: Prices):
        self.prices = prices
        self.rows: List[dict] = []

    def add(self, phase: str, group: str, item: str, key: str, qty: float, note: str = ""):
        self.rows.append({
            "phase": phase, "group": group, "item": item, "priceKey": key,
            "qty": qty, "unit": self.prices.unit(key),
            "usd": self.prices.cost(key, qty), "note": note,
        })

    def flat(self, phase: str, group: str, item: str, usd: float, note: str = ""):
        self.rows.append({"phase": phase, "group": group, "item": item, "priceKey": None,
                          "qty": 1, "unit": "flat", "usd": usd, "note": note})

    def total(self, phase: str) -> float:
        return sum(r["usd"] for r in self.rows if r["phase"] == phase)

    def by_group(self, phase: str) -> Dict[str, float]:
        out: Dict[str, float] = {}
        for r in self.rows:
            if r["phase"] == phase:
                out[r["group"]] = out.get(r["group"], 0.0) + r["usd"]
        return dict(sorted(out.items(), key=lambda kv: -kv[1]))


# ---------------------------------------------------------------- shared helpers
def polly_key(engine: str) -> str:
    return {"standard": "polly_standard_char", "neural": "polly_neural_char",
            "generative": "polly_generative_char"}[engine]


def lambda_lines(L: Ledger, phase: str, group: str, name: str, invocations: float,
                 mem_mb: float, ms: float):
    gb_s = invocations * (mem_mb / 1024.0) * (ms / 1000.0)
    L.add(phase, group, f"{name} compute ({mem_mb:.0f} MB x {ms:.0f} ms)", "lambda_gb_s", gb_s)
    L.add(phase, group, f"{name} requests", "lambda_request", invocations)


def derived(a: dict) -> dict:
    c, m = a["catalog"], a["media"]
    chars = c["chars"] + c["spanish_extra_chars"]
    avg = c["chars"] / c["passages"]
    plays = a["traffic"]["weekly_plays"] * WEEKS_PER_MONTH
    return {
        "chars": chars,
        "avg_chars": avg,
        "plays_month": plays,
        "audio_s_avg": avg * m["audio_ms_per_char"] / 1000.0,
        "mp3_bytes_avg": avg * m["mp3_bytes_per_char"],
        "record_bytes_avg": avg * m["product_json_bytes_per_char"],
        "timing_bytes_avg": avg * m["timing_bytes_per_char"],
    }


# ---------------------------------------------------------------- scenario: current
def scenario_current(a: dict, P: Prices) -> Ledger:
    L = Ledger(P)
    d = derived(a)
    c, m, po = a["catalog"], a["media"], a["polly"]["current"]
    passages = c["passages"]
    tracks = po["voices_per_lang"]
    churn = a["churn"]["monthly_regen_share"]

    def generate(phase: str, share: float, label: str):
        n = passages * share
        chars = d["chars"] * share
        billed = chars * tracks * po["calls_per_track"]
        L.add(phase, "Polly", f"{po['engine']} chars ({tracks} voices x {po['calls_per_track']} calls){label}",
              polly_key(po["engine"]), billed, "ETL bills MP3 + speech-marks request per track")
        puts = n * (1 + tracks * 4)  # product JSON + per track: mp3, timing, marks, input
        L.add(phase, "S3", f"PUT requests{label}", "s3_put", puts)
        wru = n * math.ceil(d["record_bytes_avg"] / 1024.0) * 2  # base table + lang-index GSI (ALL)
        L.add(phase, "DynamoDB", f"record writes incl. GSI{label}", "ddb_wru", wru)

    generate("one-time", 1.0, " - full catalog")
    generate("monthly", churn, f" - {churn:.0%} churn")

    # storage at steady state
    mp3_gb = d["chars"] * m["mp3_bytes_per_char"] * tracks / GIB
    small_gb = d["chars"] * (m["timing_bytes_per_char"] * tracks + m["product_json_bytes_per_char"] * 2) / GIB
    noncurrent_gb = (mp3_gb + small_gb) * churn * 3  # 90-day noncurrent version expiry
    L.add("monthly", "S3", f"storage: MP3 ({tracks} voices) + JSON + 90-day old versions", "s3_storage_gb_mo",
          mp3_gb + small_gb + noncurrent_gb)
    ddb_gb = passages * d["record_bytes_avg"] * 2 / GIB
    L.add("monthly", "DynamoDB", "storage (table + GSI)", "ddb_storage_gb_mo", ddb_gb)
    L.add("monthly", "DynamoDB", "PITR backup storage", "ddb_pitr_gb_mo", ddb_gb / 2)

    # cloud ETL: S3 incoming/ -> EventBridge (S3 events to the default bus are free) -> etl-run Lambda
    el = a["etl_lambda_current"]
    lambda_lines(L, "one-time", "Lambda", "etl-run - full catalog", passages, el["mem_mb"], el["ms_per_passage"])
    lambda_lines(L, "monthly", "Lambda", f"etl-run - {churn:.0%} churn", passages * churn,
                 el["mem_mb"], el["ms_per_passage"])

    # playback: browser -> CloudFront (no caching for page + sa/) -> NLB -> EKS pods (nginx)
    plays = d["plays_month"]
    t = a["traffic"]
    k = a["eks_current"]
    play_gb = plays * (d["mp3_bytes_avg"] * t["mp3_fraction_downloaded"] + d["timing_bytes_avg"]
                       + d["record_bytes_avg"] + t["app_bytes_per_play"]) / GIB
    L.add("monthly", "CloudFront", "data transfer out (US)", "cf_egress_gb", play_gb,
          "origin fetch NLB -> CloudFront is free")
    L.add("monthly", "CloudFront", "HTTPS requests", "cf_https_request", plays * t["cf_requests_per_play"])
    L.add("monthly", "EKS frontend", "EKS control plane", "eks_cluster_hr", k["hours"])
    L.add("monthly", "EKS frontend", f"{k['nodes']}x t3.medium worker node", "ec2_t3_medium_hr", k["hours"] * k["nodes"])
    L.add("monthly", "EKS frontend", "node EBS (gp3)", "ebs_gp3_gb_mo", k["node_disk_gb"] * k["nodes"])
    L.add("monthly", "EKS frontend", "NAT gateway hours", "nat_hr", k["hours"])
    L.add("monthly", "EKS frontend", "NLB hours", "nlb_hr", k["hours"])
    # NLB TCP LCU: 1 GB/hour processed per LCU dominates at this traffic.
    L.add("monthly", "EKS frontend", "NLB capacity units (bytes processed)", "nlb_lcu_hr",
          max(play_gb / k["hours"], 1.0) * k["hours"])
    L.add("monthly", "EKS frontend", "public IPv4 addresses (NAT + NLB)", "public_ipv4_hr", k["public_ipv4"] * k["hours"])
    syncs = k["pods"] * (k["hours"] * 3600 / 30)
    L.add("monthly", "S3", "pod sidecar LIST every 30 s", "s3_put", syncs, "LIST is billed at the PUT tier")
    L.add("monthly", "EKS frontend", "NAT data (sidecar pulls regenerated media)", "nat_gb",
          d["chars"] * churn * (m["mp3_bytes_per_char"] * tracks) * k["pods"] / GIB)

    # ad-hoc POST usage
    ap = a["api_current"]
    if ap["post_requests_month"]:
        n = ap["post_requests_month"]
        L.add("monthly", "Polly", "API POST chars (default track, 2 calls)", polly_key(po["engine"]),
              n * ap["post_avg_chars"] * 2)
        L.add("monthly", "API Gateway", "HTTP API POST", "httpapi_request", n)
        lambda_lines(L, "monthly", "Lambda", "tts-post", n, 1024, ap["post_lambda_ms"])

    # logs: playback no longer goes through Lambda, so only ETL runs log.
    # (API Lambdas have no retention set; ETL logs keep 30 days.)
    o = a["observability"]
    log_gb = passages * churn * o["log_bytes_per_invocation"] * 5 / GIB
    L.add("monthly", "CloudWatch", "Lambda log ingest (ETL runs)", "cw_logs_ingest_gb", log_gb)
    L.add("monthly", "CloudWatch", "Lambda log storage (30-day retention)", "cw_logs_store_gb_mo", log_gb)

    s = a["security"]
    L.add("monthly", "KMS", "customer-managed key", "kms_key_mo", s["kms_keys"])
    L.add("monthly", "KMS", "API requests (bucket key on)", "kms_request", s["kms_requests_month"])
    return L


# ---------------------------------------------------------------- scenario: target
def scenario_target(a: dict, P: Prices) -> Ledger:
    L = Ledger(P)
    d = derived(a)
    c, m, po = a["catalog"], a["media"], a["polly"]["target"]
    passages = c["passages"]
    comp = c["computerized_share"]
    tracks = po["voices_per_lang"]
    churn = a["churn"]["monthly_regen_share"]
    lt, f, b = a["lambda_target"], a["fargate"], a["bedrock"]

    def generate(phase: str, share: float, label: str, backfill: bool):
        n = passages * share
        billed = d["chars"] * share * comp * tracks * po["calls_per_track"]
        L.add(phase, "Polly", f"{po['engine']} chars, computerized {comp:.0%} only{label}",
              polly_key(po["engine"]), billed, "human-audio passages skip synthesis")
        # WhisperX alignment on every passage (TTS and human audio)
        task_h = n * tracks * (d["audio_s_avg"] * f["realtime_factor"] + f["overhead_s"]) / 3600.0
        L.add(phase, "Fargate (WhisperX)", f"vCPU-hours ({f['vcpu']} vCPU){label}", "fargate_vcpu_hr", task_h * f["vcpu"])
        L.add(phase, "Fargate (WhisperX)", f"GB-hours ({f['memory_gb']} GB){label}", "fargate_gb_hr", task_h * f["memory_gb"])
        calls = n * b["word_stops_per_passage"]
        L.add(phase, "Bedrock", f"Word Stops input tokens{label}", "bedrock_in_mtok", calls * b["input_tokens_per_call"] / 1e6)
        L.add(phase, "Bedrock", f"Word Stops output tokens{label}", "bedrock_out_mtok", calls * b["output_tokens_per_call"] / 1e6)
        L.add(phase, "Step Functions", f"state transitions{label}", "sfn_transition", n * a["stepfunctions"]["transitions_per_passage"])
        for name in ("tokenizer", "qa", "write", "word_stops"):
            mem, ms = lt[name]
            lambda_lines(L, phase, "Lambda", name + label, n, mem, ms)
        if backfill:
            mem, ms = lt["backfill_consumer"]
            lambda_lines(L, phase, "Lambda", "backfill consumer" + label, n, mem, ms)
            L.add(phase, "SQS", f"backfill queue send/receive/delete{label}", "sqs_request", n * 3)
        L.add(phase, "S3", f"PUT requests{label}", "s3_put", n * (2 + tracks * 2))
        L.add(phase, "CloudWatch", f"pipeline log ingest{label}", "cw_logs_ingest_gb",
              n * 6 * a["observability"]["log_bytes_per_invocation"] / GIB)

    generate("one-time", 1.0, " - full catalog", True)
    generate("monthly", churn, f" - {churn:.0%} churn", False)

    # storage
    mp3_gb = d["chars"] * comp * m["mp3_bytes_per_char"] * tracks / GIB
    small_gb = d["chars"] * (m["timing_bytes_per_char"] * tracks + m["product_json_bytes_per_char"]) / GIB
    noncurrent_gb = (mp3_gb + small_gb) * churn * 3
    L.add("monthly", "S3", "storage: TTS MP3 + JSON + timing + 90-day old versions", "s3_storage_gb_mo",
          mp3_gb + small_gb + noncurrent_gb, "existing human audio already stored by ReadWorks, not counted")

    # delivery via CloudFront
    t = a["traffic"]
    plays = d["plays_month"]
    cf_gb = plays * (d["mp3_bytes_avg"] * t["mp3_fraction_downloaded"] + d["timing_bytes_avg"]
                     + d["record_bytes_avg"] + t["app_bytes_per_play"]) / GIB
    L.add("monthly", "CloudFront", "data transfer out (US)", "cf_egress_gb", cf_gb,
          "S3 -> CloudFront origin transfer is free; flat-rate plans / 1 TB free tier not applied")
    L.add("monthly", "CloudFront", "HTTPS requests", "cf_https_request", plays * t["cf_requests_per_play"])
    L.add("monthly", "S3", "origin GETs (cache misses, ~2%)", "s3_get", plays * t["cf_requests_per_play"] * 0.02)

    # content API VM
    e = a["ec2"]
    L.add("monthly", "EC2 content API", f"{e['instance']} on-demand x {e['hours']} h", "ec2_t3_small_hr", e["hours"])
    L.add("monthly", "EC2 content API", "gp3 EBS volume", "ebs_gp3_gb_mo", e["ebs_gb"])

    # observability
    o = a["observability"]
    L.add("monthly", "CloudWatch", "alarms", "cw_alarm_mo", o["alarms"])
    L.add("monthly", "CloudWatch", "dashboards", "cw_dashboard_mo", o["dashboards"])
    log_gb = passages * churn * 6 * o["log_bytes_per_invocation"] / GIB
    L.add("monthly", "CloudWatch", f"log storage ({o['log_retention_months_target']}-month retention)",
          "cw_logs_store_gb_mo", log_gb * o["log_retention_months_target"])
    L.add("monthly", "SNS", "daily DLQ report", "sns_request", 31)

    # security baseline
    s = a["security"]
    L.add("monthly", "KMS", "customer-managed key", "kms_key_mo", s["kms_keys"])
    L.add("monthly", "KMS", "API requests (bucket key on)", "kms_request", s["kms_requests_month"])
    L.add("monthly", "Security", "Secrets Manager secrets", "secret_mo", s["secrets"])
    L.flat("monthly", "Security", "GuardDuty (flat assumption)", s["guardduty_usd_month"],
           "depends on CloudTrail/S3 data events; check the GuardDuty usage page after 30 days")

    # Phase 4 analytics
    an = a["analytics"]
    L.add("monthly", "Analytics", "Firehose ingest (play/tap/Word Stop events)", "firehose_gb",
          plays * an["events_per_play"] * an["bytes_per_event"] / GIB)
    L.add("monthly", "Analytics", "Athena scans", "athena_tb", an["athena_tb_scanned_month"])

    # CI/CD
    cc = a["cicd"]
    L.add("monthly", "CI/CD", "CodeBuild general1.small minutes", "codebuild_min", cc["builds_per_month"] * cc["build_minutes"])
    L.add("monthly", "CI/CD", "CodePipeline V2 action minutes", "codepipeline_action_min",
          cc["builds_per_month"] * cc["pipeline_action_minutes_per_run"])

    # DynamoDB stays as the reference table
    ddb_gb = passages * d["record_bytes_avg"] * 2 / GIB
    L.add("monthly", "DynamoDB", "storage (table + GSI)", "ddb_storage_gb_mo", ddb_gb)
    L.add("monthly", "DynamoDB", "PITR backup storage", "ddb_pitr_gb_mo", ddb_gb / 2)
    return L


# ---------------------------------------------------------------- engine comparison (task 3.9)
def engine_comparison(a: dict, P: Prices) -> List[dict]:
    d = derived(a)
    comp = a["catalog"]["computerized_share"]
    out = []
    for engine, tracks, calls, scope, label in [
        ("neural", 2, 2, 1.0, "current ETL: neural, 2 voices, MP3 + speech marks, whole catalog"),
        ("neural", 1, 2, 1.0, "neural, 1 voice, MP3 + speech marks, whole catalog"),
        ("neural", 1, 2, comp, "neural, 1 voice, MP3 + speech marks, computerized only"),
        ("generative", 1, 1, comp, "target: generative, 1 voice, MP3 only (WhisperX timing), computerized only"),
        ("generative", 2, 1, comp, "generative, 2 voices, computerized only"),
        ("standard", 1, 2, comp, "standard, 1 voice, MP3 + speech marks, computerized only"),
    ]:
        billed = d["chars"] * scope * tracks * calls
        out.append({"option": label, "billedChars": billed, "usd": P.cost(polly_key(engine), billed)})
    return out


# ---------------------------------------------------------------- price refresh
def refresh_prices(region_profile: Optional[str]) -> None:
    import boto3  # only needed here
    sess = boto3.Session(profile_name=region_profile) if region_profile else boto3.Session()
    client = sess.client("pricing", region_name="us-east-1")
    data = load_json("prices.json")
    changed, missing = [], []
    for key, entry in data["prices"].items():
        q = entry.get("query")
        if not q:
            continue
        filters = [{"Type": "TERM_MATCH", "Field": "usagetype", "Value": q["usagetype"]}]
        for k, v in q.get("filters", {}).items():
            filters.append({"Type": "TERM_MATCH", "Field": k, "Value": v})
        tiers = {}
        for page in client.get_paginator("get_products").paginate(ServiceCode=q["service"], Filters=filters):
            for raw in page["PriceList"]:
                prod = json.loads(raw)
                for term in prod.get("terms", {}).get("OnDemand", {}).values():
                    for pd in term["priceDimensions"].values():
                        tiers[float(pd["beginRange"])] = float(pd["pricePerUnit"]["USD"])
        if not tiers:
            missing.append(key)
            continue
        new = [[b, tiers[b]] for b in sorted(tiers)]
        new = [[int(b) if b.is_integer() else b, p] for b, p in new]
        if new != entry["tiers"]:
            changed.append(f"{key}: {entry['tiers']} -> {new}")
            entry["tiers"] = new
    data["_fetched"] = _dt.date.today().isoformat()
    (HERE / "prices.json").write_text(json.dumps(data, indent=2) + "\n")
    print(f"prices.json refreshed ({data['_fetched']}). changed: {len(changed)}, missing: {len(missing)}")
    for c in changed:
        print("  changed", c)
    for k in missing:
        print("  MISSING (kept old value)", k)


# ---------------------------------------------------------------- output
def usd(x: float) -> str:
    return f"${x:,.2f}" if x >= 0.01 or x == 0 else f"${x:,.4f}"


def qty(x: float) -> str:
    return f"{x:,.0f}" if x >= 100 else f"{x:,.3g}"


def render_md(results: Dict[str, Ledger], a: dict, P: Prices, engines: List[dict]) -> str:
    d = derived(a)
    lines = [
        "# Sound Along cost estimate",
        "",
        f"On-demand list prices, us-west-2, fetched {P.fetched}. No free tier, credits, or discounts applied.",
        f"Drivers: {a['catalog']['passages']:,} passages, {d['chars']:,.0f} chars, "
        f"{d['plays_month']:,.0f} plays/month ({a['traffic']['weekly_plays']:,}/week), "
        f"{a['churn']['monthly_regen_share']:.0%} monthly regeneration.",
        "",
        "## Summary",
        "",
        "| Scenario | One-time backfill | Monthly run rate | First year (backfill + 12 months) |",
        "|---|---:|---:|---:|",
    ]
    for name, L in results.items():
        one, mon = L.total("one-time"), L.total("monthly")
        lines.append(f"| {name} | {usd(one)} | {usd(mon)} | {usd(one + 12 * mon)} |")
    for name, L in results.items():
        for phase in ("one-time", "monthly"):
            lines += ["", f"## {name}: {phase} by service", "", "| Service | USD | Share |", "|---|---:|---:|"]
            tot = L.total(phase) or 1.0
            for g, v in L.by_group(phase).items():
                lines.append(f"| {g} | {usd(v)} | {v / tot:.1%} |")
        lines += ["", f"<details><summary>{name}: line items</summary>", "",
                  "| Phase | Service | Item | Quantity | Unit | USD |", "|---|---|---|---:|---|---:|"]
        for r in L.rows:
            lines.append(f"| {r['phase']} | {r['group']} | {r['item']} | {qty(r['qty'])} | {r['unit']} | {usd(r['usd'])} |")
        lines += ["", "</details>"]
    lines += ["", "## Polly engine options for the full catalog (one-time)", "",
              "| Option | Billed chars | USD |", "|---|---:|---:|"]
    for e in engines:
        lines.append(f"| {e['option']} | {e['billedChars']:,.0f} | {usd(e['usd'])} |")
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenario", choices=["current", "target", "both"], default="both")
    ap.add_argument("--format", choices=["md", "json"], default="md")
    ap.add_argument("--set", action="append", default=[], metavar="key.path=value",
                    help="override an assumption, e.g. traffic.weekly_plays=500000")
    ap.add_argument("--out", help="write the report to this file as well as stdout")
    ap.add_argument("--refresh-prices", action="store_true",
                    help="re-pull prices from the AWS Price List API (read-only) and exit")
    ap.add_argument("--profile", help="AWS profile for --refresh-prices")
    args = ap.parse_args(argv)

    if args.refresh_prices:
        refresh_prices(args.profile)
        return 0

    a = load_json("assumptions.json")
    apply_overrides(a, args.set)
    P = Prices(load_json("prices.json"))
    results: Dict[str, Ledger] = {}
    if args.scenario in ("current", "both"):
        results["current (deployed CDK)"] = scenario_current(a, P)
    if args.scenario in ("target", "both"):
        results["target (full architecture)"] = scenario_target(a, P)
    engines = engine_comparison(a, P)

    if args.format == "json":
        report = json.dumps({
            "pricesFetched": P.fetched, "derived": derived(a), "overrides": args.set,
            "scenarios": {n: {"oneTimeUsd": L.total("one-time"), "monthlyUsd": L.total("monthly"),
                              "byService": {"one-time": L.by_group("one-time"), "monthly": L.by_group("monthly")},
                              "lines": L.rows} for n, L in results.items()},
            "pollyEngines": engines,
        }, indent=2)
    else:
        report = render_md(results, a, P, engines)
    print(report)
    if args.out:
        Path(args.out).write_text(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
