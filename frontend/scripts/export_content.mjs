// Exports the built-in content (MODES, CARDS, CATALOG) exactly as the app
// assembles it, so the seeder can load byte-identical passages into the cloud.
// This is the single source of truth for the one-time migration: run it, then
// lambda/scripts/seed_content.py loads the JSON into DynamoDB. After the player
// reads everything from the cloud, the data_*.js files (and this script) go away.
//
//   node scripts/export_content.mjs > /tmp/sa-content.json
//
// Node 20+ (ESM). No bundler: the data modules are plain ESM with no DOM use
// except catalog.js, which only uses string ops, so it runs under Node.

import { MODES, CARDS } from '../src/data.js'
import { CATALOG, byMode } from '../src/catalog.js'

// A mode is what the player's load() consumes (paras, stops, forms, questions,
// details, lang, voice). A catalog entry is the list/metadata record (pid,
// band, grade, genre, lexile, tags, modes:{en,es}). We emit both, linked, so
// the cloud can reconstruct exactly what the frontend had.

// Only the vocab CARDS actually referenced by a mode's tokens/stops are worth
// carrying per passage; but to stay faithful we emit the whole CARDS map once.
const content = {
  version: 1,
  exportedAt: new Date().toISOString(),
  cards: CARDS,
  modes: MODES.map(m => ({
    id: m.id,
    band: m.band || null,
    lang: m.lang || 'en-US',
    title: m.title,
    tab: m.tab, sub: m.sub, voice: m.voice, reward: m.reward,
    stopTitle: m.stopTitle, how: m.how,
    audio: m.audio || null,
    rwf: m.rwf || null, gen: m.gen || null,
    details: m.details || [],
    paras: m.paras || [],
    stops: m.stops || [],
    forms: m.forms || null,
    cardOverride: m.cardOverride || null,
    questions: m.questions || null,
  })),
  catalog: CATALOG.map(e => ({
    pid: e.pid, band: e.band, title: e.title, grade: e.grade,
    genre: e.genre, lexile: e.lexile || null, order: e.order,
    words: e.words, minutes: e.minutes, tags: e.tags || [],
    url: e.url || null,
    vocab: e.vocab || [],
    questions: e.questions || 0, stops: e.stops || 0,
    modes: e.modes,
  })),
}

// Sanity: every catalog entry's en mode must exist, so the seeder can link them.
const modeIds = new Set(content.modes.map(m => m.id))
const orphans = content.catalog.filter(e => !modeIds.has(e.modes.en)).map(e => e.pid)
if (orphans.length) process.stderr.write(`WARN catalog entries with no en mode: ${orphans.join(', ')}\n`)

process.stdout.write(JSON.stringify(content))
process.stderr.write(`exported ${content.modes.length} modes, ${content.catalog.length} catalog entries, ${Object.keys(content.cards).length} cards\n`)
