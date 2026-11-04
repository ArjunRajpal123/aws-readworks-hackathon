#!/usr/bin/env node
// Export every passage and question the player shows into ETL input JSON, using
// the ids the player fetches audio by (sa/product/<id>.soundAlong.json):
//   demo passages     mode.id          k2, k2es, 35, ...
//   sentence sets     <RW id>[es]      E1, E1es, ...
//   full passages     F<n>             F1 ... F9
//   question audio    question id      E1q1, ...
// Text is reduced to exactly the words the player renders (its markup such as
// *word, ~1word, -1word, =1word and a trailing ^ is stripped the same way as
// engine.js parse()), so token i in the pipeline is word i on screen.
//
// Writes one JSON object per line to stdout; nothing is saved in the repo.
// Pipe it into the uploader, which checks and sends each one to S3 incoming/:
//
//   node etl/export_player_inputs.mjs | .venv-etl/bin/python etl/upload_incoming.py -          # dry run
//   node etl/export_player_inputs.mjs | .venv-etl/bin/python etl/upload_incoming.py - --yes    # upload
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'frontend', 'src')

const { MODES } = await import(join(SRC, 'data.js'))

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
  // Full passages (F*) are English text even in the Spanish-interface modes.
  const lang = /^F\d/.test(id) ? 'en' : (m.lang || 'en-US').slice(0, 2)
  add(id, lang, m.title, playerParas(m.paras), `mode ${m.id}`)
  for (const q of m.questions || []) add(q.id, 'en', `${m.title}: ${q.id}`, plainParas(q.paras), `question in ${m.id}`)
}

for (const it of items.values()) process.stdout.write(JSON.stringify(it) + '\n')
console.error(`exported ${items.size} passages/questions`)
