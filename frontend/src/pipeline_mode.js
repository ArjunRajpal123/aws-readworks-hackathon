// Pipeline passages: open any passage the ETL (etl/run_local.py, run_aws.py) or the API wrote,
// fetched via GET /api/v1/text-to-speech (src/api.js), with ?m=<id>, not only the passages built
// into the app. The text comes from the product's contentTokenized, one player token per pipeline
// word, so the word count matches the timing file and the Polly voices (Danielle/Stephen, Lupe/Pedro) play.

import { fetchProduct, createProduct } from './api.js'
import { translate } from './data_api.js'

const ID_RE = /^[A-Za-z0-9._-]{1,64}$/

// Words as parse() in engine.js will see them: it splits on whitespace, so a word must not contain any.
const word = s => s.textContent.replace(/\s+/g, '')

export function parasFromProduct(prod) {
  const doc = new DOMParser().parseFromString(prod.contentTokenized || '', 'text/html')
  const ps = [...doc.querySelectorAll('p')]
  return (ps.length ? ps : [doc.body])
    .map(p => [...p.querySelectorAll('[data-w]')].map(word).filter(Boolean).join(' '))
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

// Translate a passage (en <-> es) and generate that version through the
// pipeline under `id` (Amazon Translate, then Polly voices for that language).
// Returns createProduct's {ok, record|error}, plus the translated text.
export async function makeTranslation({ text, title, from, to, id, allVoices = true }) {
  const [tr, tt] = await Promise.all([translate(text, from, to), translate(title || id, from, to)])
  if (!tr || !tr.text) return { ok: false, error: 'Translation failed' }
  const res = await createProduct({ text: tr.text, id, title: ((tt && tt.text) || title || id).slice(0, 200), languageCode: to === 'es' ? 'es-US' : 'en-US', allVoices })
  return { ...(res || { ok: false, error: 'No API configured' }), text: tr.text }
}

function buildMode(id, prod, band, MODES) {
  const es = prod.lang === 'es'
  const look = MODES.find(m => m.id === band + (es ? 'es' : '')) || MODES.find(m => m.id === band)
  const voices = prod.tracks.map(t => t.voiceId).filter(Boolean).join(', ')
  const mode = {
    id, band, audio: id, pipeline: true,
    lang: es ? 'es-US' : 'en-US', tab: look.tab, sub: look.sub, voice: look.voice, reward: look.reward,
    stopTitle: look.stopTitle, how: look.how,
    title: prod.title || id,
    details: es
      ? [['Fuente', 'Sound Along pipeline'], ['Id', id], ['Voces', voices]]
      : [['Source', 'Sound Along pipeline'], ['Id', id], ['Voices', voices]],
    paras: parasFromProduct(prod),
    stops: [],
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
  const mode = buildMode(id, prod, band, MODES)
  if (!mode) return null
  // The possible sibling id (may or may not exist on the backend).
  mode.sibId = siblingId(id, prod.lang === 'es' ? 'en' : 'es')
  if (!MODES.some(m => m.id === id)) MODES.push(mode)
  return mode
}

// Register the sibling-language passage, link it, and return its id. Called
// by the language toggle on demand. A passage made before both languages were
// generated up front has no sibling yet: it is translated and generated now
// (onMaking() is called first, since that takes a few seconds). Returns null
// if there is no sibling and it could not be made.
export async function ensureSibling(MODES, mode, { onMaking } = {}) {
  if (!mode || !mode.pipeline) return null
  if (mode.sib && MODES.some(m => m.id === mode.sib)) return mode.sib
  const sib = mode.sibId
  if (!sib || sib === mode.id || !ID_RE.test(sib)) return null
  let sibMode = MODES.find(m => m.id === sib)
  if (!sibMode) {
    let sibProd = await fetchProduct(sib)
    if (!sibProd || !Array.isArray(sibProd.tracks)) {
      if (onMaking) onMaking()
      const from = mode.lang === 'es-US' ? 'es' : 'en'
      const res = await makeTranslation({ text: mode.paras.join('\n\n'), title: mode.title, from, to: from === 'es' ? 'en' : 'es', id: sib })
      if (!res.ok) return null
      sibProd = res.record
    }
    if (!sibProd || !Array.isArray(sibProd.tracks)) return null
    sibMode = buildMode(sib, sibProd, mode.band, MODES)
    if (!sibMode) return null
    sibMode.sibId = mode.id
    MODES.push(sibMode)
  }
  mode.sib = sib; sibMode.sib = mode.id
  return sib
}
