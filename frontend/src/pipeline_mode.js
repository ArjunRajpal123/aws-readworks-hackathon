// Pipeline passages: open any passage the ETL (etl/run_local.py, run_aws.py) or the API wrote,
// fetched via GET /api/v1/text-to-speech (src/api.js), with ?m=<id>, not only the passages built
// into the app. The text comes from the product's contentTokenized, one player token per pipeline
// word, so the word count matches the timing file and the Polly voices (Danielle/Stephen, Lupe/Pedro) play.

import { fetchProduct } from './api.js'

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

// Fetches the product record and adds a mode for it to MODES. Returns the mode, or null if there is
// no such product (the caller then opens the default passage).
export async function addPipelineMode(MODES, id, { band = '35' } = {}) {
  if (!ID_RE.test(id)) return null
  const prod = await fetchProduct(id)
  if (!prod || !Array.isArray(prod.tracks)) return null
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
  if (!mode.paras.length) return null
  MODES.push(mode)
  return mode
}
