#!/usr/bin/env node
// Export every passage and question the player shows into ETL input JSON, using
// the ids the player fetches audio by (sa/product/<id>.soundAlong.json).
// The passages come from the content export the cloud is seeded from
// (frontend/scripts/export_content.mjs, then lambda/scripts/localize_content.py):
//   demo passages     mode.id                 k2, k2es, 35, ...
//   sentence sets     rws-<rw id>-<en|es>     rws-e1-en, rws-e1-es, ...   (data_rw.js)
//   full passages     rwf-<rw id>-en          rwf-e1-en ... rwf-e9-en     (data_full.js)
//   grade stories     g-<id>-en               g-k1-en, ...                (grade_modes.js)
//   question audio    question.audio          rwq-e1q1-en, g-k1q1-en, ... (data_full.js, grade_modes.js)
// Each id is set once in the player's data (mode.audio / question.audio), so the
// player and the pipeline always agree. An id ending in -en / -es sets the language.
// Text is reduced to exactly the words the player renders (its markup such as
// *word, ~1word, -1word, =1word and a trailing ^ is stripped the same way as
// engine.js parse()), so token i in the pipeline is word i on screen.
//
// Writes one JSON object per line to stdout. Pipe it into the uploader, which
// checks and sends each one to S3 incoming/:
//
//   node etl/export_player_inputs.mjs --content sa-content.json | uv run python etl/upload_incoming.py -          # dry run
//   node etl/export_player_inputs.mjs --content sa-content.json | uv run python etl/upload_incoming.py - --yes    # upload
//
// Or write one input file per id for a local run (etl/run_local.py):
//
//   node etl/export_player_inputs.mjs --content sa-content.json --out-dir etl/inputs [--only rwf-,rwq-,g-]
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
if (!arg('--content')) { console.error('usage: export_player_inputs.mjs --content <export.json> [--out-dir dir] [--only prefixes]'); process.exit(2) }
const { modes: MODES } = JSON.parse(readFileSync(arg('--content'), 'utf8'))
const OUT_DIR = arg('--out-dir')
const ONLY = (arg('--only') || '').split(',').filter(Boolean)

// Same rules as engine.js parse(): split on whitespace, drop a trailing ^,
// then strip any run of (~|-|=)<digit> or a leading * from the word.
function playerWord(raw) {
  let t = raw
  if (t.endsWith('^')) t = t.slice(0, -1)
  let m
  while ((m = t.match(/^([~\-=])(\d)/)) || (t[0] === '*' && t.length > 1)) t = m ? t.slice(2) : t.slice(1)
  return t
}
const playerParas = paras => paras.map(p => p.split(/\s+/).filter(Boolean).map(playerWord))
// questions.js para(): plain whitespace split, no markup.
const plainParas = paras => paras.map(p => p.trim().split(/\s+/).filter(Boolean))

// -en / -es at the end of an audio id names its language.
const langOf = id => (/-(en|es)$/.exec(id) || [])[1]

const items = new Map()
function add(id, lang, title, words, source) {
  const text = words.map(w => w.join(' ')).join('\n\n')
  const tokens = words.reduce((n, w) => n + w.length, 0)
  const prev = items.get(id)
  if (prev) {
    if (prev.text !== text) console.warn(`! ${id}: ${source} differs from ${prev._source}; keeping the first`)
    return
  }
  items.set(id, { id, lang, title, text, _playerTokens: tokens, _source: source })
}

for (const m of MODES) {
  if (!m.paras) continue
  const id = m.audio || m.id
  // An id's -en/-es suffix wins: full passages and grade stories are English text
  // even in the Spanish-interface modes.
  const lang = langOf(id) || (m.lang || 'en-US').slice(0, 2)
  add(id, lang, m.title, playerParas(m.paras), `mode ${m.id}`)
  for (const q of m.questions || []) {
    const qid = q.audio || q.id
    add(qid, langOf(qid) || 'en', `${m.title}: ${q.id}`, plainParas(q.paras), `question in ${m.id}`)
  }
}

const wanted = [...items.values()].filter(it => !ONLY.length || ONLY.some(p => it.id.startsWith(p)))
if (OUT_DIR) {
  for (const { id, lang, title, text, _source } of wanted) {
    const rec = { id, lang, title, text, source: { file: 'frontend/src via etl/export_player_inputs.mjs', from: _source } }
    writeFileSync(join(OUT_DIR, `${id}.json`), JSON.stringify(rec, null, 2) + '\n')
  }
  console.error(`wrote ${wanted.length} input files to ${OUT_DIR}`)
} else {
  for (const it of wanted) process.stdout.write(JSON.stringify(it) + '\n')
  console.error(`exported ${wanted.length} of ${items.size} passages/questions`)
}
