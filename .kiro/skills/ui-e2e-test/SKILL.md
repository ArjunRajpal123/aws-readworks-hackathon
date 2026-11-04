---
name: ui-e2e-test
description: Functional test the Sound Along web app (frontend/) end to end in a real browser with Playwright, turn every failure into a ticket, show the tickets to the user, and delegate fixes to subagents. Use when asked to UI test, browser test, end-to-end test, Playwright test or "test all the app's functionality", to check the player, Word Stops, word cards, grade bands, Spanish, accessibility settings, game features or Polly audio playback, to run an axe/WCAG scan, or to file and fix UI bugs.
compatibility: Node 18+ and npm. Headless Chromium via Playwright (first run downloads it, and Linux needs Chromium's system libraries). Fully offline. No AWS calls.
metadata:
  version: "1.0"
---
# Sound Along UI testing with Playwright

The suite drives the Vue app in `frontend/` through headless Chromium, the same way a student would use it. It derives its expectations from the app's own content (`frontend/src/data.js`, `data_es.js`, `i18n.js`), so a new passage or Word Stop gets tested without anyone editing the specs.

Work in four phases: **run → ticket → highlight → delegate**. Stop after the highlight phase and let the user choose which tickets to fix. Only delegate the tickets the user approves.

## Layout

| Path | What |
|---|---|
| `playwright.config.js` | Starts a private Vite dev server on port 5199 (set `SA_UI_URL` to test a deployed URL instead). Uses `desktop` (all tests) and `mobile` (Pixel 7, `@mobile`-tagged tests only). Retries a failed test once, so a test that passes on the retry is reported as flaky. |
| `tests/fixtures.js` | Fake `speechSynthesis` that records what the app says and makes the player use its deterministic word timer. Fails the test on any uncaught page error or `console.error`. Also exports `MODES`, `CARDS`, `I18N` and helper functions. |
| `tests/load-and-navigation.spec.js` | `@smoke`: page load, every `?m=` passage, tabs, saved passage, English/Spanish toggle |
| `tests/player.spec.js` | `@player`: play/pause/resume, tap to replay, ±5 s, speed, voice, keyboard, end of passage |
| `tests/word-stops.spec.js` | `@stops`: every Word Stop in every passage, wrong answer then right answer, clue reveal, tap-the-clue, written reply, Stops off, read aloud |
| `tests/word-cards.spec.js` | `@cards`: every vocabulary word opens the right card with band-specific content, Hear it, keyboard |
| `tests/accessibility-settings.spec.js` | `@a11y-settings`: size, font, spacing, sentence highlight, reading strip, theme, contrast, motion, follow, reset, persistence |
| `tests/game.spec.js` | `@game`: glow jar, badges, streak/moves/colour, word bank and clipboard copy |
| `tests/pipeline-audio.spec.js` | `@pipeline`: ETL product passages and Polly audio (uses `frontend/public/sa/` when present, plus synthetic fixtures served with `page.route`) |
| `tests/axe.spec.js` | `@axe`: WCAG 2.1 A/AA scan of every passage in light and dark, plus panels |
| `scripts/make_tickets.mjs` | Turns `out/results.json` into tickets in `out/tickets/` |

Each `describe` block has `area` and `files` annotations. The ticket generator copies them into the ticket, so the person or subagent fixing it knows where to start.

## Phase 1: run

From the repo root:

```bash
cd .kiro/skills/ui-e2e-test
npm ci                                   # first time only
npx playwright install chromium          # first time only
npx playwright test                      # full suite: about 200 tests, 4-9 min
npx playwright test --grep @smoke        # quick check, under 1 min
SA_UI_ALL=1 npx playwright test          # every generated passage too (1000+ tests, slow)
```

Passage coverage: the hand-built demo passages (`k2`, `35`, `68`, `912` and their `es` versions) are always tested in full. Generated passage families (`rw-*`, `rwf-*`, and any other `<prefix>-*` ids) are sampled: by default the first 2 of each family (`SA_UI_SAMPLE=n` to change). Use `SA_UI_ALL=1` before a release or after changing how passages are generated.

If Chromium fails with `error while loading shared libraries`, install its system libraries. On Amazon Linux 2023: `sudo dnf install -y atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite libXdamage libXrandr libXfixes mesa-libgbm pango alsa-lib nss nspr`. On Debian/Ubuntu: `sudo npx playwright install-deps chromium`. Ask the user before running `sudo`.

Rules:
- Don't pass `--reporter=...` on the command line. It replaces the configured JSON reporter, and the ticket step needs `out/results.json`.
- Port 5199 is used so the run doesn't disturb a dev server the user has open on 5173. If 5199 is taken by something that isn't this app, set `SA_UI_PORT`.
- To test another environment, set `SA_UI_URL=https://…/`. Confirm the URL with the user first.

## Phase 2: ticket

```bash
node scripts/make_tickets.mjs
```

This writes `out/tickets/SA-UI-###.md` (one per root cause), `index.json` and `SUMMARY.md`, and prints the summary. Grouping rules:
- Failures with the same spec, describe block and normalised first error line become one ticket. For example, one bug that breaks 8 passages produces one ticket listing 8 cases.
- axe failures produce one ticket per WCAG rule, listing each page state and the failing nodes.
- Priority: **P1** for smoke, player, Word Stops and pipeline failures, and for any uncaught page error. **P2** for other functional failures and serious/critical axe rules. **P3** for minor axe rules and flaky tests.

**Triage before showing anything.** For each ticket, open the error and trace (`npx playwright show-trace <path>`) and decide which case applies:
- **App bug**: the app does something wrong for a user. Keep the ticket. Add a `## Root cause` section to the ticket file with the file and line you suspect, and a one-line explanation.
- **Test bug**: the test's expectation or locator is wrong. Fix the test and re-run it, and don't file a ticket. Mention the fix in your report.
- **Environment**: the cause is the machine (missing libraries, port in use, no pipeline sample). Fix it or skip the test with a `test.skip` reason, and tell the user.

Never weaken an assertion just to turn a run green.

## Phase 3: highlight to the user

Show the tickets before changing any app code. Use this format:

1. One line with the pass/fail/flaky/skipped counts from `SUMMARY.md`.
2. A table with one row per ticket: id, priority, a short title in plain words, what the user would notice, and the suspected file.
3. Mark each ticket that should be done in sequence (two tickets that touch the same lines) and each one that needs a product decision instead of a code fix. For example, the colour of the hint text, or whether an aria-label should read the inflected word or the base word.
4. Ask which tickets to delegate. Default to suggesting the P1 tickets plus any P2 tickets with an obvious fix.

Then set the session status to waiting on the user.

## Phase 4: delegate to subagents

Once the user approves a set of tickets:

1. Group the tickets that touch the same file region into one subagent (for example, two `engine.js` fixes in `load()`) so parallel edits don't conflict. Tickets that touch different files can each get their own subagent.
2. Dispatch one `general-task-execution` subagent per group with `invoke_sub_agent`. Run them in parallel when their files don't overlap. Pass the ticket file in `contextFiles`, and use this prompt:

   > Fix ticket `<id>` in the Sound Along frontend. The ticket is at `<path>` and has the failing cases, the error, the suspected root cause and the reproduce command. Constraints: change only files under `frontend/src/`. Don't edit anything under `.kiro/skills/ui-e2e-test/tests/` unless you can show the test is wrong, and if you do, explain why. Keep the existing code style (compact imperative JS in `engine.js`). Don't add dependencies. When you're done, run the reproduce command from the ticket and `npx playwright test --grep @smoke` from `.kiro/skills/ui-e2e-test`. Both must pass. Report the root cause, the diff summary and the test output.

3. When every subagent has finished, re-run the full suite and `node scripts/make_tickets.mjs`. Confirm each delegated ticket is gone and no new tickets appeared. If a fix broke something else, the new ticket goes back to the user, not straight to another subagent.
4. Optionally run the `regression-test` skill (its `frontend` gate checks that `vite build` still works).
5. Report back with: the tickets fixed (id, one line on the fix, files changed), the tickets still open, and the final counts.

Don't commit, push or open pull requests unless the user asks.

## Extending the suite

- New passages, stops and cards in `data*.js` are picked up automatically by the `@smoke`, `@stops`, `@cards` and `@axe` loops.
- A new Word Stop `type` needs a branch in `answer()` in `tests/word-stops.spec.js`.
- A new control: add the test to the spec for its area, and give any new `describe` block `area` and `files` annotations.
- Loop over `PASSAGES` (sampled), not `MODES`, in data-driven tests. Use `modeById()` for a specific passage.
- Read option lists, labels and strings from the page or from `I18N`. Don't hard-code them: the UI changes often, and hard-coded values create test-bug tickets.
- Use `openApp(page, id)` to load the app, `tr(lang, key, ...)` for UI strings (never hard-code English text), and `spoken(page)` to check what the app said aloud.
