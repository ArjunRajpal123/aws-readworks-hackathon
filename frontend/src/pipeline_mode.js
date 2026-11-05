// Pipeline passages: open any passage the ETL (etl/run_local.py, run_aws.py) or the API wrote,
// fetched via GET /api/v1/text-to-speech (src/api.js), with ?m=<id>, not only the passages built
// into the app. The text comes from the product's contentTokenized, one player token per pipeline
// word, so the word count matches the timing file and the Polly voices (Danielle/Stephen, Lupe/Pedro) play.

import { fetchProduct } from './api.js'
import { getPassageCards } from './data_api.js'

const ID_RE = /^[A-Za-z0-9._-]{1,64}$/

// Words as parse() in engine.js will see them: it splits on whitespace, so a word must not contain any.
const word = s => s.textContent.replace(/\s+/g, '')

// Normalize a word the same way engine.js keyFor() does, so a passage word and
// a vocab card word compare equal (case/accents/punctuation stripped).
const normWord = w => (w || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')

export function parasFromProduct(prod, markSet) {
  const doc = new DOMParser().parseFromString(prod.contentTokenized || '', 'text/html')
  const ps = [...doc.querySelectorAll('p')]
  const marks = markSet || new Set()
  const mark = w => (normWord(w) && marks.has(normWord(w)) ? '*' + w : w)
  return (ps.length ? ps : [doc.body])
    .map(p => [...p.querySelectorAll('[data-w]')].map(word).filter(Boolean).map(mark).join(' '))
    .filter(Boolean)
}

// The sibling-language id, matching the GET handler's resolution
// (lambda/text_to_speech_get/handler.py sibling_id): <id>-en <-> <id>-es, else <id> <-> <id>es.
export function siblingId(id, lang) {
  const m = /^(.*)-(en|es)$/.exec(id)
  if (m) return `${m[1]}-${lang}`
  const base = id.endsWith('es') ? id.slice(0, -2) : id
  return lang === 'es' ? base + 'es' : base
}

// A per-mode vocab card map {normalizedWord: card} + the set of normalized keys
// to underline, from the passage's saved cards (data API pcards). Empty when
// the passage has no cards.
async function cardsForPassage(id) {
  let rec = null
  try { rec = await getPassageCards(id) } catch { rec = null }
  const cards = {}, keys = new Set()
  for (const c of (rec && rec.cards) || []) {
    const k = normWord(c && c.word)
    if (!k || cards[k]) continue
    cards[k] = { word: c.word, pos: c.pos || '', def: c.def || '', ex: c.ex || '', syn: [], es: [] }
    keys.add(k)
  }
  return { cards, keys }
}

async function buildMode(id, prod, band, MODES) {
  const es = prod.lang === 'es'
  const look = MODES.find(m => m.id === band + (es ? 'es' : '')) || MODES.find(m => m.id === band)
  const voices = prod.tracks.map(t => t.voiceId).filter(Boolean).join(', ')
  // Pull the passage's saved vocab cards so matching words underline + open.
  const { cards, keys } = await cardsForPassage(id)
  const mode = {
    id, band, audio: id, pipeline: true,
    lang: es ? 'es-US' : 'en-US', tab: look.tab, sub: look.sub, voice: look.voice, reward: look.reward,
    stopTitle: look.stopTitle, how: look.how,
    title: prod.title || id,
    details: es
      ? [['Fuente', 'Sound Along pipeline'], ['Id', id], ['Voces', voices]]
      : [['Source', 'Sound Along pipeline'], ['Id', id], ['Voices', voices]],
    paras: parasFromProduct(prod, keys),
    stops: [],
    // Per-passage cards so engine.js can underline + open words that aren't in
    // the shared global CARDS (each language carries its own cards).
    cards,
  }
  return mode.paras.length ? mode : null
}

// Fetches the product record and adds a mode for it to MODES. Records the
// other-language sibling id on mode.sibId (resolved lazily by the language
// toggle via ensureSibling, so the initial load stays a single fetch).
// Returns the mode for `id`, or null if there is no such product.
export async function addPipelineMode(MODES, id, { band = '35' } = {}) {
  if (!ID_RE.test(id)) return null
  const prod = await fetchProduct(id)
  if (!prod || !Array.isArray(prod.tracks)) return null
  const mode = await buildMode(id, prod, band, MODES)
  if (!mode) return null
  // The possible sibling id (may or may not exist on the backend).
  mode.sibId = siblingId(id, prod.lang === 'es' ? 'en' : 'es')
  if (!MODES.some(m => m.id === id)) MODES.push(mode)
  return mode
}

// Register the sibling-language passage if the backend has one, link it, and
// return its id. Called by the language toggle on demand. Returns null if
// there is no sibling (toggle then just keeps the current text).
export async function ensureSibling(MODES, mode) {
  if (!mode || !mode.pipeline) return null
  if (mode.sib && MODES.some(m => m.id === mode.sib)) return mode.sib
  const sib = mode.sibId
  if (!sib || sib === mode.id || !ID_RE.test(sib)) return null
  let sibMode = MODES.find(m => m.id === sib)
  if (!sibMode) {
    const sibProd = await fetchProduct(sib)
    if (!sibProd || !Array.isArray(sibProd.tracks)) return null
    sibMode = await buildMode(sib, sibProd, mode.band, MODES)
    if (!sibMode) return null
    sibMode.sibId = mode.id
    MODES.push(sibMode)
  }
  mode.sib = sib; sibMode.sib = mode.id
  return sib
}
