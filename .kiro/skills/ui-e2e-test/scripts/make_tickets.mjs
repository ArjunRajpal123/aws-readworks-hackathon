#!/usr/bin/env node
// Turn Playwright's JSON report (out/results.json) into one ticket per failure group.
//
// Grouping: failures that share the same spec file, describe block and normalised
// error message become one ticket, so "the same bug seen in 8 passages" is one
// ticket listing 8 cases, not 8 tickets.
//
// Output (all under out/tickets/, regenerated every run):
//   SA-UI-###.md   one Markdown ticket per group (title, priority, area, repro, evidence)
//   index.json     machine-readable list, used by the agent to delegate to subagents
//   SUMMARY.md     table to show the user
//
// Usage: node scripts/make_tickets.mjs [--results out/results.json] [--out out/tickets]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const resultsPath = path.resolve(root, arg('--results', 'out/results.json'))
const outDir = path.resolve(root, arg('--out', 'out/tickets'))

if (!fs.existsSync(resultsPath)) {
  console.error(`No results at ${resultsPath}. Run "npx playwright test" first.`)
  process.exit(2)
}
const report = JSON.parse(fs.readFileSync(resultsPath, 'utf8'))
const strip = s => (s || '').replace(/\u001b\[[0-9;]*m/g, '')

// ---- collect failing / flaky tests --------------------------------------------------
const failures = []
function walk(suite, trail) {
  const t = suite.title ? [...trail, suite.title] : trail
  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      const results = test.results || []
      const last = results[results.length - 1] || {}
      const flaky = test.status === 'flaky'
      if (test.status !== 'unexpected' && !flaky) continue
      const failed = results.find(r => r.status !== 'passed' && r.status !== 'skipped') || last
      const err = failed.error || (failed.errors || [])[0] || {}
      const ann = Object.fromEntries((test.annotations || []).map(a => [a.type, a.description]))
      failures.push({
        file: spec.file, line: spec.line, describe: t.slice(1).join(' › '), title: spec.title,
        project: test.projectName, flaky, tags: (spec.tags || []).map(t => t.startsWith('@') ? t : '@' + t),
        axeList: (results.flatMap(r => r.attachments || []).find(a => a.name === 'axe-violations') || {}).body,
        area: ann.area || t.slice(1).join(' › '), files: ann.files || '',
        message: strip(err.message || 'No error message'), stack: strip(err.stack || ''),
        snippet: strip(err.snippet || ''),
        attachments: (failed.attachments || []).filter(a => a.path).map(a => ({ name: a.name, path: path.relative(path.resolve(root, '../../..'), a.path) })),
      })
    }
  }
  for (const s of suite.suites || []) walk(s, t)
}
for (const s of report.suites || []) walk(s, [])

// ---- group into tickets -------------------------------------------------------------
function signature(msg) {
  const first = msg.split('\n').find(l => l.trim()) || ''
  return first
    .replace(/\d+(\.\d+)?/g, 'N')            // numbers, indices, timings
    .replace(/["“][^"”]{0,200}["”]/g, '"…"') // quoted values (titles, words)
    .replace(/\s+/g, ' ').trim().slice(0, 160)
}
// axe failures carry several rules in one message; split them so each WCAG rule is its own ticket.
function explodeAxe(f) {
  if (!f.tags.includes('@axe') || f.flaky || !f.axeList) return [f]
  let list
  try { list = JSON.parse(Buffer.from(f.axeList, 'base64').toString('utf8')) } catch { return [f] }
  return list.map(v => ({ ...f, axe: v, message: `axe ${v.rule} (${v.impact}): ${v.help}\n${v.url}\nNodes (${v.count}): ${v.nodes.join(' | ')}` }))
}
const groups = new Map()
for (const f of failures.flatMap(explodeAxe)) {
  const key = f.axe ? `axe|${f.axe.rule}` : [f.file, f.describe, f.flaky ? 'flaky' : 'fail', signature(f.message)].join('|')
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(f)
}

function priority(cases) {
  const c = cases[0]
  if (cases.every(x => x.flaky)) return 'P3'
  if (c.tags.includes('@smoke') || /pageerror|console\.error/.test(c.message)) return 'P1'
  if (c.tags.includes('@player') || c.tags.includes('@stops') || c.tags.includes('@pipeline')) return 'P1'
  if (c.tags.includes('@axe')) return c.axe && ['critical', 'serious'].includes(c.axe.impact) ? 'P2' : 'P3'
  return 'P2'
}
function kind(c) {
  if (c.flaky) return 'flaky-test'
  if (c.tags.includes('@axe')) return 'accessibility'
  if (/pageerror|console\.error/.test(c.message)) return 'runtime-error'
  if (/Test timeout of|timed out after/i.test(c.message)) return 'timeout'
  return 'functional'
}
function titleFor(cases) {
  const c = cases[0], k = kind(c)
  if (k === 'accessibility') {
    const what = c.axe ? `${c.axe.rule}: ${c.axe.help}` : 'axe violations'
    return `Accessibility ${what} (${cases.length} page state${cases.length > 1 ? 's' : ''})`
  }
  if (k === 'flaky-test') return `Flaky: ${c.describe} › ${c.title}`
  if (k === 'runtime-error') {
    const err = (c.message.match(/(?:pageerror|console\.error): (.*)/) || [])[1] || 'page error'
    return `Runtime error in ${c.describe}: ${err}`.slice(0, 140)
  }
  const titles = [...new Set(cases.map(x => x.title))]
  return `${c.describe}: ${titles[0]}${titles.length > 1 ? ` (+${titles.length - 1} similar)` : ''}`.slice(0, 160)
}

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const order = { P1: 1, P2: 2, P3: 3 }
const tickets = [...groups.values()]
  .map(cases => ({ cases, priority: priority(cases), kind: kind(cases[0]) }))
  .sort((a, b) => order[a.priority] - order[b.priority] || b.cases.length - a.cases.length)
  .map((t, i) => ({ id: `SA-UI-${String(i + 1).padStart(3, '0')}`, title: titleFor(t.cases), ...t }))

const specPath = f => `.kiro/skills/ui-e2e-test/tests/${f}`
for (const t of tickets) {
  const c = t.cases[0]
  const greps = [...new Set(t.cases.map(x => x.title))]
  const rerun = `cd .kiro/skills/ui-e2e-test && npx playwright test ${c.file} --project=${c.project} -g "${greps.length === 1 ? greps[0].replace(/["$`\\]/g, '\\$&') : c.describe.replace(/["$`\\]/g, '\\$&')}"`
  const md = `# ${t.id}: ${t.title}

| Field | Value |
|---|---|
| Priority | ${t.priority} |
| Type | ${t.kind} |
| Area | ${c.area} |
| Likely files | ${c.files || 'unknown'} |
| Spec | \`${specPath(c.file)}:${c.line}\` |
| Failing cases | ${t.cases.length} |
| Status | open |

## Failing cases
${t.cases.map(x => `- \`${x.title}\` (${x.project}${x.flaky ? ', passed on retry' : ''})${x.axe ? `: \`${x.axe.nodes.join('`, `')}\`` : ''}`).join('\n')}

## Error (first case)
\`\`\`
${c.message.slice(0, 4000)}
\`\`\`
${c.snippet ? `\n## Where it failed\n\`\`\`\n${c.snippet.slice(0, 2000)}\n\`\`\`\n` : ''}
## Evidence
${t.cases.flatMap(x => x.attachments.map(a => `- ${x.title}: ${a.name} \`${a.path}\``)).slice(0, 20).join('\n') || '- none captured'}

Open a trace with: \`npx playwright show-trace <trace.zip>\` (run from \`.kiro/skills/ui-e2e-test\`).

## Reproduce
\`\`\`bash
${rerun}
\`\`\`

## Done when
- Root cause is fixed in the app (not by weakening the test), or the test is shown to be wrong and corrected with a note explaining why.
- The command under "Reproduce" passes, and the full suite has no new failures.
`
  fs.writeFileSync(path.join(outDir, `${t.id}.md`), md)
}

const stats = report.stats || {}
const index = {
  generatedAt: new Date().toISOString(),
  stats: { passed: stats.expected || 0, failed: stats.unexpected || 0, flaky: stats.flaky || 0, skipped: stats.skipped || 0, durationMs: Math.round(stats.duration || 0) },
  tickets: tickets.map(t => ({
    id: t.id, title: t.title, priority: t.priority, kind: t.kind, area: t.cases[0].area,
    files: t.cases[0].files, spec: specPath(t.cases[0].file), cases: t.cases.map(x => x.title),
    ticket: path.relative(path.resolve(root, '../../..'), path.join(outDir, `${t.id}.md`)),
  })),
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2))
const summary = `# Sound Along UI test run

Passed ${index.stats.passed} · Failed ${index.stats.failed} · Flaky ${index.stats.flaky} · Skipped ${index.stats.skipped}

| Ticket | Priority | Type | Title | Cases | Likely files |
|---|---|---|---|---|---|
${index.tickets.map(t => `| ${t.id} | ${t.priority} | ${t.kind} | ${t.title.replace(/\|/g, '\\|')} | ${t.cases.length} | ${(t.files || '').split(';')[0]} |`).join('\n') || '| none | | | All tests passed | | |'}
`
fs.writeFileSync(path.join(outDir, 'SUMMARY.md'), summary)
console.log(summary)
console.log(`Tickets written to ${path.relative(process.cwd(), outDir) || '.'}`)
