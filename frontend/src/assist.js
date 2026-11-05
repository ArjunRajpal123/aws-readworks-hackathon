// Admin form assist: work out what is knowable from the text itself, and (on request) ask an AI service for suggestions.
// detect() runs in the browser with plain rules. aiSuggest() calls window.SA_AI_ENDPOINT if the team sets one; otherwise it
// returns a clearly labelled simulation so the screen can be demonstrated.
import { RW_KNOWN } from './vocab_db.js'
import { RW } from './data_rw.js'
import { CARDS } from './content.js'

const EN_STOP = new Set(('the of and to a in is that it was for on are as with his they at be this from have or by one had not but what all were when we there can an your which their said if do will each about how up out them then she many some so these would other into has more her two like him see time could no make than first been its who now people my made over did down only way find use may water long little very after words called just where most know get through back much before go good new write our me man too any day same right look think also around another came come work three word must because does part even place well such here take why help put different away again off went old number great tell men say small every found still between name should home big give air line set own under read last never us left end along while might next sound below saw something thought both few those always looked show large often together asked house world going want school important until form food keep children feet land side without boy once animals life enough took sometimes four head above kind began almost live page got earth need far hand high year mother light country father let night picture being study second soon story since white ever paper hard near sentence better best across during today however sure knew try told young sun thing whole hear example heard several change answer room sea against top turned learn point city play toward five using himself usually he i you').split(' '))
const ES_STOP = new Set(('el la los las de del y en que es un una por con para su sus al lo como más pero se no son está este esta ese esa muy también hay fue había era han ha le les me mi tu si ya o sin sobre entre cuando porque donde todo todos todas cada otro otra otros otras nos ellos ellas él ella yo usted ser estar tener hacer qué cómo había hacia desde hasta tan solo sólo mismo vez dos tres').split(' '))
const ABBR = /^(mr|mrs|ms|dr|st|jr|sr|sra|srta|prof|vs|etc|ee|uu|p\.m|a\.m)\.$/i
const SUFFIX = ['', 'e', 's', 'es', 'ed', 'd', 'ing', 'ly', 'er', 'ers', 'red', 'ring', 'ion', 'ions', 'al']

const plain = w => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '')
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const wordsOf = s => (s.match(/[\p{L}][\p{L}'’-]*/gu) || [])

function syllables(w) {
  w = w.toLowerCase().replace(/[^a-záéíóúüñ]/g, '')
  if (!w) return 0
  const groups = (w.match(/[aeiouyáéíóúü]+/g) || []).length
  const silentE = /[^aeiouy]e$/.test(w) && !/le$/.test(w) && groups > 1 ? 1 : 0
  return Math.max(1, groups - silentE)
}

function vocabDb() {
  const map = new Map()
  for (const p of RW_KNOWN) for (const w of p.vocab) if (!map.has(w)) map.set(w, 'ReadWorks · ' + p.title)
  for (const c of Object.values(CARDS)) {
    const w = (c.word || '').toLowerCase()
    if (w.length > 2 && !map.has(w)) map.set(w, 'Demo vocabulary')
  }
  return map
}
const DB = vocabDb()
export const vocabularyCount = () => DB.size

function matchVocab(words) {
  const found = new Map()
  const lemmas = [...DB.keys()]
  for (const raw of words) {
    const t = plain(raw)
    if (t.length < 3) continue
    for (const lemma of lemmas) {
      const l = plain(lemma)
      const stem = l.replace(/e$/, '')
      if (t === l || (t.startsWith(stem) && SUFFIX.includes(t.slice(stem.length)) && stem.length >= 4)) {
        if (!found.has(lemma)) found.set(lemma, { word: lemma, seenAs: raw.toLowerCase(), source: DB.get(lemma) })
        break
      }
    }
  }
  return [...found.values()].slice(0, 40)
}

function matchKnown(text) {
  const n = norm(text)
  for (const p of RW_KNOWN) if (n.includes(p.key)) return p
  for (const s of RW) {
    for (const sentence of [...s.en, ...s.es]) {
      const key = norm(sentence).slice(0, 60)
      if (key.length >= 40 && n.includes(key)) return RW_KNOWN.find(p => p.id === s.id)
    }
  }
  return null
}

export function detect(text, fileName) {
  text = (text || '').trim()
  if (text.length < 40) return null
  const toks = text.split(/\s+/)
  const words = wordsOf(text)
  let en = 0, es = 0
  for (const w of words) { const lw = w.toLowerCase(); if (EN_STOP.has(lw)) en++; if (ES_STOP.has(lw)) es++ }
  es += (text.match(/[¿¡ñáéíóúü]/gi) || []).length * 0.5
  const lang = es > en ? 'es-US' : 'en-US'
  const confidence = Math.min(1, Math.abs(en - es) / Math.max(1, en + es))
  let sentences = 0
  for (const w of toks) if (/[.!?]["”’)»]*$/.test(w) && !ABBR.test(w.replace(/["“”‘’(¿¡«]/g, ''))) sentences++
  sentences = Math.max(1, sentences)
  const nWords = Math.max(1, words.length)
  const syl = words.reduce((n, w) => n + syllables(w), 0)
  let grade
  if (lang === 'en-US') grade = 0.39 * (nWords / sentences) + 11.8 * (syl / nWords) - 15.59
  else {
    const ease = 206.84 - 60 * (syl / nWords) - 1.02 * (nWords / sentences) // Fernandez Huerta reading ease
    grade = ease >= 90 ? 2 : ease >= 80 ? 3 : ease >= 70 ? 5 : ease >= 60 ? 7 : ease >= 50 ? 9 : ease >= 30 ? 11 : 12
  }
  grade = Math.max(0, Math.min(12, Math.round(grade)))
  const band = grade <= 2 ? 'k2' : grade <= 5 ? '35' : grade <= 8 ? '68' : '912'

  const lines = text.split(/\r?\n/).map(l => l.trim())
  const first = lines[0] || ''
  let titleGuess = ''
  if (first && first.length <= 90 && !/[.!]$/.test(first) && lines.length > 1) titleGuess = first
  else if (fileName) titleGuess = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  return { lang, confidence, words: nWords, sentences, grade, band, vocab: matchVocab(words), known: matchKnown(text), titleGuess }
}

// Form fields are derived locally (fast, free) from the text; the VOCABULARY
// comes from real Bedrock cards via the data API (POST /api/v1/data/cards),
// which is the live AI path. The old window.SA_AI_ENDPOINT (/api/v1/assist)
// was removed when we adopted the data API, so we no longer call it.
export async function aiSuggest(text, det) {
  // ---- local heuristics for the simple form fields ----
  const words = wordsOf(text)
  const stop = det && det.lang === 'es-US' ? ES_STOP : EN_STOP
  const freq = new Map()
  for (const w of words) { const lw = w.toLowerCase(); if (lw.length >= 5 && !stop.has(lw)) freq.set(lw, (freq.get(lw) || 0) + 1) }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0])
  const quotes = (text.match(/["“”«»]/g) || []).length
  const pronouns = (text.match(/\b(he|she|they|él|ella|ellos|ellas)\b/gi) || []).length
  const genre = quotes >= 6 || pronouns / Math.max(1, words.length) > 0.03 ? 'fiction' : 'nonfiction'
  const fields = { adGenre: genre }
  if (top.length) fields.adTopic = top.slice(0, 2).map(w => w[0].toUpperCase() + w.slice(1)).join(', ')
  if (top.length) fields.adTitle = (det && det.lang === 'es-US' ? 'Texto sobre ' : 'Passage about ') + top[0]

  // ---- vocabulary: real Bedrock cards via the data API (guardrailed) ----
  let vocabulary, mode = 'simulated'
  try {
    const { hasDataApi, genCards } = await import('./data_api.js')
    if (hasDataApi()) {
      const r = await genCards(text, (det && det.lang === 'es-US') ? 'es' : 'en')
      if (r && Array.isArray(r.cards)) { vocabulary = r.cards.map(c => c.word).filter(Boolean); mode = 'service' }
    }
  } catch { /* fall back to local candidates below */ }
  if (!vocabulary) {
    const known = new Set(DB.keys())
    vocabulary = [...new Set(words.map(w => w.toLowerCase()).filter(w => w.length >= 8 && !stop.has(w) && !known.has(w)))].slice(0, 6)
  }
  return { mode, fields, vocabulary }
}
