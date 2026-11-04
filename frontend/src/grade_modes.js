// Turns the grade-level sample passages into player modes, and marks key words in the full ReadWorks passages so their word cards open.
import { GRADE } from './data_grade.js'
import { RWF_VOCAB } from './rwf_vocab.js'
import { GRADE_STOPS } from './grade_stops.js'

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')
const GENRE_ES = { Fiction: 'Ficción', Nonfiction: 'No ficción' }

export function addGrade(MODES, CARDS) {
  // Key words in the ReadWorks passages (the same text is used by every copy of the passage).
  for (const [pid, list] of Object.entries(RWF_VOCAB)) {
    const forms = {}
    list.forEach(([w, pos, def]) => { CARDS[`${pid}_${w}`] = { word: w, pos, def, ex: '', syn: [], es: [] } })
    for (const m of MODES) {
      if (m.rwf !== pid) continue
      m.forms = forms
      m.paras = m.paras.map(p => p.split(/(\s+)/).map(tok => {
        const bare = norm(tok), hit = list.find(([w]) => bare === norm(w))
        if (hit && !tok.startsWith('*')) { forms[bare] = `${pid}_${hit[0]}`; return '*' + tok }
        return tok
      }).join(''))
    }
  }
  // Original passages for the other grade bands.
  for (const it of GRADE) {
    const forms = {}
    it.vocab.forEach(v => { CARDS[`${it.id}_${v.w}`] = { word: v.w, pos: v.pos, def: v.def, ex: v.ex, syn: [], es: [] } })
    it.paras.join(' ').split(/\s+/).forEach(raw => {
      if (raw[0] !== '*') return
      const w = norm(raw), v = it.vocab.find(v => w.startsWith(norm(v.w)))
      if (v) forms[w] = `${it.id}_${v.w}`
    })
    // Word Stops: mark the end of each stop's sentence with ^ and build the stop objects (multiple choice only).
    const paras = it.paras.slice(), stops = []
    for (const sp of GRADE_STOPS[it.id] || []) {
      const pi = paras.findIndex(p => p.includes(sp.at))
      if (pi < 0) continue
      const at = paras[pi].indexOf(sp.at) + sp.at.length
      paras[pi] = paras[pi].slice(0, at) + '^' + paras[pi].slice(at)
      stops.push({ word: `${it.id}_${sp.w}`, type: 'choice', move: sp.move, q: sp.q, choices: sp.choices.map((t, i) => (i === sp.a ? { t, ok: true } : { t })), right: sp.right, rightPlain: sp.right, wrong: sp.wrong, clue: sp.clue, notes: sp.notes })
    }
    const questions = it.questions.map((q, i) => ({
      id: `${it.id}q${i + 1}`, qid: `${it.id}q${i + 1}`, type: 0, abridged: false, nq: 1,
      paras: [q.q, ...q.options.map((o, k) => `${'ABCD'[k]}. ${o}`)], correct: q.correct,
      audio: `g-${it.id.toLowerCase()}q${i + 1}-en`, // pipeline product for this question
    }))
    const words = it.paras.join(' ').split(/\s+/).length
    for (const es of [false, true]) {
      const base = MODES.find(m => m.id === it.band + (es ? 'es' : ''))
      MODES.push({
        id: `g-${it.id}${es ? '-es' : ''}`, band: it.band, gen: it.id, lang: es ? 'es-US' : 'en-US',
        audio: `g-${it.id.toLowerCase()}-en`, // pipeline product; the story text is English in both UI languages
        tab: base.tab, sub: base.sub, voice: base.voice, reward: base.reward, stopTitle: base.stopTitle, how: base.how,
        title: it.title,
        details: es
          ? [['Grado', it.grade], ['Género', GENRE_ES[it.genre] || it.genre], ['Palabras', words], ['Texto', 'Texto original escrito para Sound Along.']]
          : [['Grade', it.grade], ['Genre', it.genre], ['Words', words], ['Text', 'Original text written for Sound Along.']],
        paras, stops, forms, questions,
      })
    }
  }
}
