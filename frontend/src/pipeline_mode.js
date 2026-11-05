// Pipeline passages: open any passage the ETL (etl/run_local.py, run_aws.py) or the API wrote,
// fetched via GET /api/v1/text-to-speech (src/api.js), with ?m=<id>, not only the passages built
// into the app. The text comes from the product's contentTokenized, one player token per pipeline
// word, so the word count matches the timing file and the Polly voices (Danielle/Stephen, Lupe/Pedro) play.

import { fetchProduct } from './api.js'

const ID_RE = /^[A-Za-z0-9._-]{1,64}$/

// Words as parse() in engine.js will see them: it splits on whitespace, so a word must not contain any.
const word = s => s.textContent.replace(/\s+/g, '')

// Normalize a word the same way engine.js keyFor() does, so a passage word and
// a vocabulary card word compare equal regardless of case/accents/punctuation.
const normWord = w => (w || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')

// Build the player's paragraph strings from the product's tokenized content.
// When the product carries vocabulary cards, the matching words are prefixed
// with '*' so engine.js parse() tags them as vocab (underlined + tappable);
// the card map (returned separately) lets the player show the card.
export function parasFromProduct(prod, cardKeys) {
  const doc = new DOMParser().parseFromString(prod.contentTokenized || '', 'text/html')
  const ps = [...doc.querySelectorAll('p')]
  const marks = cardKeys || new Set()
  const markWord = w => {
    // Preserve any trailing stop marker engine.js expects; just prefix '*'.
    const bare = normWord(w)
    return bare && marks.has(bare) ? '*' + w : w
  }
  return (ps.length ? ps : [doc.body])
    .map(p => [...p.querySelectorAll('[data-w]')].map(word).filter(Boolean).map(markWord).join(' '))
    .filter(Boolean)
}

// A mode-local card map {normalizedWord: {word, pos, def, ex}} from the
// product's vocabulary, plus the set of normalized keys to underline.
function cardsFromProduct(prod) {
  const cards = {}, keys = new Set()
  for (const c of prod.vocabulary || []) {
    const k = normWord(c && c.word)
    if (!k || cards[k]) continue
    cards[k] = { word: c.word, pos: c.pos || '', def: c.def || '', ex: c.ex || '', syn: [], es: [] }
    keys.add(k)
  }
  return { cards, keys }
}

// Fetches the product record and adds a mode for it to MODES. Returns the mode, or null if there is
// no such product (the caller then opens the default passage).
export async function addPipelineMode(MODES, id, { band = '35' } = {}) {
  if (!ID_RE.test(id)) return null
  const prod = await fetchProduct(id)
  if (!prod || !Array.isArray(prod.tracks)) return null
  const es = prod.lang === 'es'
  const look = MODES.find(m => m.id === band + (es ? 'es' : '')) || MODES.find(m => m.id === band)
  const voices = prod.tracks.map(t => t.voiceId).filter(Boolean).join(', ')
  const { cards, keys } = cardsFromProduct(prod)
  const review = prod.review || null
  const details = es
    ? [['Fuente', 'Sound Along pipeline'], ['Id', id], ['Voces', voices]]
    : [['Source', 'Sound Along pipeline'], ['Id', id], ['Voices', voices]]
  if (review && review.reviewStatus === 'draft') {
    details.push(es ? ['Estado', 'Borrador de IA — pendiente de revisión'] : ['Status', 'AI draft — pending review'])
  }
  const mode = {
    id, band, audio: id, pipeline: true,
    lang: es ? 'es-US' : 'en-US', tab: look.tab, sub: look.sub, voice: look.voice, reward: look.reward,
    stopTitle: look.stopTitle, how: look.how,
    title: prod.title || id,
    review,
    details,
    paras: parasFromProduct(prod, keys),
    stops: [],
    // Mode-local vocabulary cards so the player can underline + open words
    // without them being in the global CARDS (engine.js falls back to this).
    cards,
  }
  if (!mode.paras.length) return null
  MODES.push(mode)
  return mode
}
