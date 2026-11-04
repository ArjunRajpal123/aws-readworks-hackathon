---
name: regression-test
description: Run the Sound Along regression suite before merging or after changing etl/, lambda/, frontend/ or infra/cdk/. Use when asked to regression test, check nothing broke, verify a refactor, compare pipeline output against the golden snapshots, or update the goldens after an intended output change. Fully offline (fake Polly, no AWS calls, no cost).
---

# Sound Along regression testing

Confirms a change did not alter behaviour it was not meant to alter. Everything
runs offline: the ETL uses `etl/tests/fakes.py` (deterministic fake Polly with
real-shaped speech marks, in-memory storage), and CDK synth uses a dummy account.

## Gates

| Gate | What it checks | Command it runs |
| --- | --- | --- |
| `python` | ETL + Lambda unit tests | `pytest etl/tests lambda/tests` |
| `golden` | Pipeline output for every `etl/inputs/rws-*.json` is byte-for-byte what it was (see below) | `pytest .kiro/skills/regression-test/scripts` |
| `limits` | Polly caps, faults, DynamoDB size (the `etl-limit-test` skill; strict xfails flag fixed gaps) | `pytest .kiro/skills/etl-limit-test/scripts` |
| `frontend` | Vue player still builds | `vite build` to a temp dir |
| `cdk` | Stacks type-check and synthesize | `tsc --noEmit` + `cdk synth` (dummy account `123456789012`) |

The `cdk` gate bundles the Lambda code and may need Docker if local bundling is
unavailable. It never deploys.

## Workflow

1. Run all gates from the repo root:
   ```bash
   .kiro/skills/regression-test/scripts/run_regression.sh
   ```
   Or a subset: `run_regression.sh python golden`. Logs go to `/tmp/sa-regression.*/`.
2. If everything passes, report the summary table and stop.
3. If a gate fails, read its log and decide whether the change is a **regression**
   or **intended**:
   - Regression: fix the code, re-run the failing gate, then all gates.
   - Intended (e.g. a deliberate schema, voice, SSML or timing change): confirm with
     the user, then refresh the goldens (next section).
4. Never edit golden files by hand and never update them just to make a red run green.

## Golden snapshots

`scripts/test_golden.py` runs `pipeline.run()` on each committed input and compares
a normalized snapshot to `scripts/golden/<input>.json`. A snapshot contains:

- the product record and DynamoDB record (`generation.runAt` masked)
- every stored object: key, content type, encoding, content (JSON parsed and gzip
  unwrapped; SSML, text and marks as text; MP3 as size + sha256)
- the `run()` summary returned to the CLIs and the API
- the Polly request parameters (voice, engine, lexicons, sample rate, format)

A failure prints a unified diff of the snapshot, which shows exactly which field moved.

Refresh after an intended change, then review and commit the diff with the code:

```bash
.venv-etl/bin/python -m pytest .kiro/skills/regression-test/scripts -q --update-golden
git diff --stat .kiro/skills/regression-test/scripts/golden
```

When a new `etl/inputs/rws-*.json` is added, the test fails with "missing golden"
until `--update-golden` is run. A golden with no matching input also fails, so
renames are caught.

## Scope limits

- Fake Polly does not catch changes in real Polly voices or pricing. For that, run
  `etl/run_local.py` on a few inputs and review `frontend/public/sa/review.html`
  (costs about $0.01 per short passage, needs AWS credentials; ask first).
- The `frontend` gate only proves the player builds. It has no UI tests.
- The `cdk` gate does not diff templates against what is deployed; use
  `npx cdk diff` with real credentials for that.
