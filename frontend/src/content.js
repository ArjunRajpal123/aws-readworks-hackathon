// Cloud content layer. The player's passages, vocab cards, Word Stops,
// questions and catalog metadata all come from the data API
// (GET /api/v1/data/catalog and /content), seeded once from the old built-in
// data (lambda/scripts/seed_content.py). This replaces the hardcoded
// data_*.js assembly: there is no built-in content in the bundle anymore.
//
// The catalog index (small) is fetched once at boot so the grade-band tabs,
// passage lists, "what to read next" and the family views have their
// metadata. Each passage/mode's full body (paras, stops, questions) is
// fetched lazily the first time it is opened, then cached.

import { hasDataApi, getCatalog, getContent } from './data_api.js'

// Populated by hydrateContent(). MODES holds mode bodies as they are loaded;
// CARDS is the shared vocab dictionary; CATALOG is the list/metadata index.
export const MODES = []
export const CARDS = {}
export const CATALOG = []

const modeById = new Map()
let catalogLoaded = false

function indexCatalog(entries) {
  CATALOG.length = 0
  for (const e of entries) {
    CATALOG.push({ ...e, tags: e.tags || [], vocab: e.vocab || [] })
  }
}

// Fetch the catalog index + shared cards once. Returns true if cloud content
// is available. The caller (engine.init) awaits this before the first load.
export async function hydrateContent() {
  if (catalogLoaded) return true
  if (!hasDataApi()) return false
  const data = await getCatalog()
  if (!data || !Array.isArray(data.entries)) return false
  indexCatalog(data.entries)
  Object.assign(CARDS, data.cards || {})
  catalogLoaded = true
  return true
}

function registerMode(m) {
  if (!m) return null
  const existing = modeById.get(m.id)
  if (existing) return existing
  modeById.set(m.id, m)
  MODES.push(m)
  return m
}

// Fetch and cache one mode's full body by id. Returns the mode or null.
export async function loadMode(id) {
  if (modeById.has(id)) return modeById.get(id)
  if (!hasDataApi()) return null
  const m = await getContent(id)
  return m ? registerMode(m) : null
}

// Ensure every mode a catalog entry points to (en + es) is available enough
// for the band tabs/lists. Tabs only need the base band modes (k2/35/68/912)
// and their es siblings, so hydrate those eagerly; the rest load on demand.
export const BAND_MODE_IDS = ['k2', '35', '68', '912']

export async function hydrateBandModes() {
  if (!hasDataApi()) return
  const ids = []
  for (const b of BAND_MODE_IDS) { ids.push(b); ids.push(b + 'es') }
  await Promise.all(ids.map(loadMode))
}

// ---- catalog helpers (same API as the old catalog.js) ---------------------
export const BANDS = ['k2', '35', '68', '912']
export const byBand = b => CATALOG.filter(e => e.band === b)
export const byPid = pid => CATALOG.find(e => e.pid === pid)
export const byMode = id => CATALOG.find(e => e.modes && (e.modes.en === id || e.modes.es === id))
export const modeFor = (e, es) => (es && e.modes && e.modes.es && modeById.has(e.modes.es) ? e.modes.es
  : es && e.modes && e.modes.es ? e.modes.es : e.modes.en)
export const gradeText = (e, es) => (/^\d+$/.test(String(e.grade)) ? (es ? 'Grado ' : 'Grade ') : (es ? 'Grados ' : 'Grades ')) + e.grade
export const gradeNum = e => (/^\d+$/.test(String(e.grade)) ? +e.grade : { k2: 1.5, 35: 4, 68: 7, 912: 10.5 }[e.band])

export function related(pid, limit = 3) {
  const cur = byPid(pid)
  if (!cur) return []
  return CATALOG.filter(e => e.pid !== pid && e.band === cur.band).map(e => {
    const shared = (e.tags || []).filter(t => (cur.tags || []).includes(t))
    return { e, why: shared.length ? { k: 'topic', v: shared[0] } : e.genre !== cur.genre ? { k: 'genre', v: e.genre } : { k: 'band' }, score: shared.length * 3 + (e.genre !== cur.genre ? 1 : 0) - Math.abs(gradeNum(e) - gradeNum(cur)) * 0.2 }
  }).sort((a, b) => b.score - a.score).slice(0, limit)
}
export function stepUp(pid) {
  const cur = byPid(pid)
  if (!cur) return null
  const g = gradeNum(cur)
  const harder = CATALOG.filter(e => gradeNum(e) > g + 0.4 && gradeNum(e) <= g + 3).sort((a, b) => gradeNum(a) - gradeNum(b))
  return harder[0] || null
}

export const hasMode = id => modeById.has(id)

// ---- language: each catalog entry carries es: {title, vocab:[{w, def, ex, en}]}
// (lambda/scripts/localize_content.py). Words are stored in English (the `en`
// key of a Spanish vocab item) and shown in whichever language is active.
export const titleOf = (e, es) => (es && e.es && e.es.title) || e.title
export function vocabWord(w, es) {
  const lw = String(w).toLowerCase()
  for (const e of CATALOG) {
    const esv = (e.es && e.es.vocab) || []
    let v = e.vocab.find(x => x.w.toLowerCase() === lw)
    let s = v ? esv.find(x => x.en === v.w) : esv.find(x => x.w.toLowerCase() === lw)
    if (!v && s) v = e.vocab.find(x => x.w === s.en)
    if (!v && !s) continue
    const key = v ? v.w : s.w
    const shown = es && s ? s : v || s
    return { w: shown.w, def: shown.def, ex: shown.ex, title: titleOf(e, es), key, e }
  }
  return null
}
export const wordLabel = (w, es) => { const v = vocabWord(w, es); return v ? v.w : w }
