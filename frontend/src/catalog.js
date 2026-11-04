// One list of every passage the student can read, grouped by grade band, with its key words and the player mode ids.
import { MODES, CARDS } from './data.js'
import { QFULL } from './data_q.js'
import { GRADE } from './data_grade.js'
import { RWF_VOCAB } from './rwf_vocab.js'
import { RW } from './data_rw.js'
import { GRADE_STOPS } from './grade_stops.js'
import { TAGS } from './art.js'

export const BANDS = ['k2', '35', '68', '912']
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')

function sentenceWith(text, w) {
  const m = new RegExp('\\b' + w + '\\b', 'i').exec(text)
  if (!m) return ''
  let a = m.index, b = m.index
  while (a > 0 && !/[.!?]/.test(text[a - 1])) a--
  while (b < text.length && !/[.!?]/.test(text[b])) b++
  return text.slice(a, b + 1).replace(/[“”]/g, '"').trim()
}

export const CATALOG = []
function add(e) {
  CATALOG.push({ ...e, minutes: Math.max(1, Math.round(e.words / 165)), tags: TAGS[e.pid] || [] })
}

// Built-in passages with Word Stops.
for (const [id, genre, order] of [['k2', 'Nonfiction', 0], ['35', 'Fiction', 0], ['912', 'Fiction', 0]]) {
  const m = MODES.find(x => x.id === id)
  const vocab = [], seen = new Set()
  m.paras.join(' ').split(/\s+/).forEach(raw => {
    if (raw[0] !== '*') return
    const w = norm(raw), k = Object.keys(CARDS).find(k => !/\d/.test(k) && w.startsWith(k))
    if (k && !seen.has(k)) { seen.add(k); vocab.push({ w: CARDS[k].word, def: CARDS[k].def, ex: CARDS[k].ex || '' }) }
  })
  add({ pid: 'b-' + id, band: m.band || m.id, title: m.title, grade: m.tab, genre, order, words: m.paras.join(' ').split(/\s+/).length, vocab, questions: 0, stops: m.stops.length, modes: { en: id, es: id + 'es' } })
}
// Full ReadWorks passages (grade 4).
for (const [pid, it] of Object.entries(QFULL)) {
  const text = it.paras.join(' ')
  add({ url: (RW.find(p => p.id === pid) || {}).url || `https://www.readworks.org/article/${it.uuid}`, pid: 'rwf-' + pid, band: '35', title: it.title, grade: String(it.grade), lexile: it.lexile, genre: it.genre, order: 1, words: parseInt(it.words, 10) || text.split(/\s+/).length,
    vocab: (RWF_VOCAB[pid] || []).map(([w, , def]) => ({ w, def, ex: sentenceWith(text, w) })), questions: it.questions.length, stops: 0, modes: { en: `rwf-${pid}-35`, es: `rwf-${pid}-35es` } })
}
// Original passages for the other grade bands.
for (const g of GRADE) {
  add({ pid: 'g-' + g.id, band: g.band, title: g.title, grade: String(g.grade), genre: g.genre, order: 2 + g.grade / 100, words: g.paras.join(' ').split(/\s+/).length,
    vocab: g.vocab.map(v => ({ w: v.w, def: v.def, ex: v.ex })), questions: g.questions.length, stops: (GRADE_STOPS[g.id] || []).length, modes: { en: `g-${g.id}`, es: `g-${g.id}-es` } })
}
CATALOG.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))

export const byBand = b => CATALOG.filter(e => e.band === b)
export const byPid = pid => CATALOG.find(e => e.pid === pid)
export const byMode = id => CATALOG.find(e => e.modes.en === id || e.modes.es === id)
export const modeFor = (e, es) => (es && MODES.some(m => m.id === e.modes.es) ? e.modes.es : e.modes.en)
export const gradeText = (e, es) => (/^\d+$/.test(e.grade) ? (es ? 'Grado ' : 'Grade ') : (es ? 'Grados ' : 'Grades ')) + e.grade
export const gradeNum = e => (/^\d+$/.test(e.grade) ? +e.grade : { k2: 1.5, 35: 4, 68: 7, 912: 10.5 }[e.band])

// Readings that go with the one just finished: same topic first, then a different type of text, then a step up.
export function related(pid, limit = 3) {
  const cur = byPid(pid)
  if (!cur) return []
  const out = CATALOG.filter(e => e.pid !== pid && e.band === cur.band).map(e => {
    const shared = e.tags.filter(t => cur.tags.includes(t))
    return { e, why: shared.length ? { k: 'topic', v: shared[0] } : e.genre !== cur.genre ? { k: 'genre', v: e.genre } : { k: 'band' }, score: shared.length * 3 + (e.genre !== cur.genre ? 1 : 0) - Math.abs(gradeNum(e) - gradeNum(cur)) * 0.2 }
  }).sort((a, b) => b.score - a.score).slice(0, limit)
  return out
}
export function stepUp(pid) {
  const cur = byPid(pid)
  if (!cur) return null
  const g = gradeNum(cur)
  const harder = CATALOG.filter(e => gradeNum(e) > g + 0.4 && gradeNum(e) <= g + 3).sort((a, b) => gradeNum(a) - gradeNum(b))
  return harder[0] || null
}
