---
name: cost-estimate
description: Estimate the AWS cost of the Sound Along architecture, both what infra/cdk deploys today and the full target design in docs/SoundAlong-Kiro.md. Use when asked what the architecture costs, for a price estimate, budget, run rate, annual cost, backfill cost, cost per passage or per play, Polly engine cost comparison (neural vs generative vs standard), or what-if questions such as "what if plays double" or "what if we add Spanish".
compatibility: Python venv at .venv-etl. --refresh-prices needs AWS credentials with pricing:GetProducts (read-only, free).
metadata:
  version: "1.0"
---

# Sound Along cost estimate

Use this together with the `aws-billing-and-cost-management` skill. That skill covers Price List API service codes, Cost Explorer for actual spend, and Budgets.

**Do all arithmetic with `scripts/estimate_cost.py`. Never compute costs in your response.**

| File | Purpose |
|---|---|
| `scripts/estimate_cost.py` | Deterministic calculator. Prints a markdown or JSON report. |
| `scripts/assumptions.json` | Usage drivers. Each block has a `src` field naming the repo file or measurement it came from, or `ASSUMPTION`. |
| `scripts/prices.json` | us-west-2 on-demand list prices, with the date they were fetched. |
| `references/architecture.md` | What each scenario includes and what is deliberately not priced. |

## Workflow

1. **Check the price date.** If `_fetched` in `prices.json` is more than about 30 days old, refresh. The refresh only reads public price data.
   ```bash
   .venv-etl/bin/python -W ignore .kiro/skills/cost-estimate/scripts/estimate_cost.py --refresh-prices
   ```
   Report any `changed` or `MISSING` lines. Entries marked `manual` (Bedrock tokens, CloudWatch dashboard) are not refreshed and must be checked by hand.
2. **Check whether the architecture changed.** Compare `infra/cdk/lib/*.ts`, `etl/voices.json` and `docs/SoundAlong-Kiro.md` against `references/architecture.md`. If they differ (new resource, memory size, voice count, engine), update the scenario function in `estimate_cost.py` and the reference before you run the estimate.
3. **Run the estimate.**
   ```bash
   .venv-etl/bin/python .kiro/skills/cost-estimate/scripts/estimate_cost.py                          # both scenarios
   .venv-etl/bin/python .kiro/skills/cost-estimate/scripts/estimate_cost.py --scenario target --format json
   .venv-etl/bin/python .kiro/skills/cost-estimate/scripts/estimate_cost.py --out docs/COST_ESTIMATE.md
   ```
4. **For what-if questions, use `--set` instead of editing files.** Each key is a dotted path into `assumptions.json`:
   ```bash
   ... --set traffic.weekly_plays=3600000
   ... --set catalog.spanish_extra_chars=6000000
   ... --set polly.target.engine='"neural"' --set polly.target.calls_per_track=2
   ... --set traffic.mp3_fraction_downloaded=0.6
   ```
   Only edit `assumptions.json` when the user gives a new measured value. When you do, update its `src` too.
5. **Optional: compare with actual spend.** Only do this if the user asks and the account has the stacks deployed. Use Cost Explorer as described in the billing skill, filtered on the `Project=rg-readworks-bb` tag.

## Report back

- The summary table: one-time backfill, monthly run rate and first-year total for each scenario.
- The top 3 cost drivers, with their share of the total.
- The assumptions that drive those top items. Flag any marked `ASSUMPTION`, since those are the numbers worth measuring.
- What is not priced, from `references/architecture.md`.
- State that these are on-demand list prices with no Free Tier or discounts applied, and give the price date.

## Sanity checks

- With default inputs, the current-scenario Polly backfill should be about $1,280. This matches `docs/PIPELINE.md` and `docs/STAGE2_AUDIO.md`. If the result differs, a driver or price changed. Find out which one before reporting.
- Audio delivery bytes (CloudFront or S3 egress) normally dominate the monthly cost. If something else is larger, check its quantity in the line items.
