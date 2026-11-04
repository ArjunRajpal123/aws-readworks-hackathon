---
name: etl-limit-test
description: Limit-test the Sound Along ETL pipeline (etl/) and the text-to-speech API Lambda. Use when asked to limit test, stress test, load test, boundary test or throttle test the pipeline or API, to check Polly size caps (3000 spoken / 6000 SSML chars), throttling and failure behaviour, DynamoDB item size or Lambda timeout headroom, or to find the API's throughput ceiling.
compatibility: Python venv at .venv-etl (pytest, boto3). Live mode needs AWS credentials and network access.
metadata:
  version: "1.0"
---

# ETL limit testing

Two modes. **Offline is the default.** Only run live mode when the user explicitly asks for it.

| Mode | What | Cost | Script |
|---|---|---|---|
| Offline | Boundary, input-edge, fault-injection and capacity tests with a fake Polly and in-memory storage | Free, no AWS calls | `scripts/test_limits.py` |
| Live | Concurrent POSTs to the deployed API, ramping concurrency to find throttling, timeouts and throughput | Real Polly charges + S3/DynamoDB writes | `scripts/load_test.py` |

Read `references/limits.md` for the table of known limits, where each is enforced and which test covers it.

## Offline mode

Run from the repo root:

```bash
.venv-etl/bin/python -m pytest .kiro/skills/etl-limit-test/scripts -q -p no:cacheprovider
```

Expected: everything passes, plus the known-gap tests reported as `xfailed`.

Interpreting results:
- **FAILED**: a limit or contract changed. Find out whether the code change was intended. If it was, update the test and `references/limits.md`. If not, report it as a regression.
- **XPASS(strict) failure**: a known gap was fixed. Remove that test's `xfail` marker and its entry under "Known gaps" in `references/limits.md`.
- **Capacity test failures** (`test_capacity_*`): these use wall-clock budgets. Re-run once before reporting, in case the machine was busy.

When adding a limit test:
- Put it in `scripts/test_limits.py`, in the matching group (`size`, `input`, `faults`, `capacity`, or `api`).
- Use `limit_helpers.spoken_text(n, lang)` for inputs of an exact spoken length, `ScalingPolly` when the audio has to cover every word mark, and `FailingPolly` / `FailingStorage` for fault injection.
- Reuse `etl/tests/fakes.py`. Don't write new Polly fakes.
- Don't change files under `etl/` or `lambda/` just to make a limit test pass. Report the gap to the user instead, and add an `xfail(strict=True)` test if they agree it's a gap.

## Live mode (opt-in)

Before sending anything, you **must**:
1. Run the dry run (no `--yes`) and show the user the plan output: target URL, request count, concurrency steps, Polly calls and the cost estimate.
2. Get the user's explicit confirmation of the target stack or URL, AWS profile, and request/concurrency numbers. If the resolved URL isn't what the conversation assumed, stop and ask.
3. Only then re-run the same command with `--yes`.

```bash
# dry run (resolves ApiUrl from the stack output; read-only CloudFormation call)
.venv-etl/bin/python .kiro/skills/etl-limit-test/scripts/load_test.py \
  --stack rg-readworks-bb-api --profile <profile> --ramp 1,2,5 --requests-per-step 10 --chars 300

# send, after the user confirms
... same args ... --yes --report /tmp/sa-load-report.json
```

Defaults and safety rails in the script:
- Hard caps of 200 requests per run and 25 concurrency.
- Ramping stops once a step's error rate reaches `--stop-error-rate` (default 0.5).
- Start small (`--chars 300`, ramp `1,2,5`). Only increase after the user sees the first report.
- `--all-voices` doubles the Polly calls and cost per request.
- Every request uses id `lt-<runid>-<n>`. At the end, the script prints the S3 prefixes and DynamoDB ids to clean up. Ask the user before deleting anything.

Reading the report (one JSON line per step):
- `outcomes.throttled` means Polly's TPS quota was hit (API returns 502 `ThrottlingException`). Compare against the quota from `references/limits.md`.
- `outcomes.timeout` means 503/504 or a client timeout: the request exceeded the 25 s Lambda timeout or the API Gateway ~30 s limit. Check the request size and `--all-voices`.
- `okPerS` across steps shows the throughput ceiling. If it stops rising as concurrency rises, the step before is the practical limit.
- `p95ms` near 25000 means requests are close to the Lambda timeout.

The ETL runners (`etl/run_local.py`, `etl/run_aws.py`) process passages one at a time, so live load testing targets the API. To size a catalog backfill, multiply the per-request p50 from a concurrency-1 step by the passage count.

## Report back

Summarize for the user:
- pass/fail/xfail counts
- any limit that moved, with the test name and the actual value
- for live runs: throughput ceiling, first concurrency level with throttling or timeouts, the cost estimate, and the cleanup prefix
