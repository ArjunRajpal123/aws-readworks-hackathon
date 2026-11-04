// Full ReadWorks passages (grade 4) with their question sets. English text; the Spanish interface is available, the Spanish passage is pending.
import { QFULL } from './data_q.js'
import { RW } from './data_rw.js'

const GENRE_ES = { Fiction: 'Ficción', Nonfiction: 'No ficción' }

export function addFull(MODES) {
  for (const [pid, it] of Object.entries(QFULL)) {
    const url = (RW.find(p => p.id === pid) || {}).url || `https://www.readworks.org/article/${it.uuid}`
    const link = `<a href="${url}" target="_blank" rel="noopener">readworks.org</a>`
    for (const band of ['k2', '35', '68', '912']) {
      for (const es of [false, true]) {
        const base = MODES.find(m => m.id === band + (es ? 'es' : ''))
        MODES.push({
          id: `rwf-${pid}-${band}${es ? 'es' : ''}`, band, rwf: pid, audio: 'F' + pid.slice(1),
          lang: es ? 'es-US' : 'en-US', tab: base.tab, sub: base.sub, voice: base.voice, reward: base.reward, stopTitle: base.stopTitle, how: base.how,
          title: it.title,
          details: es
            ? [['Grado', it.grade], ['Lexile', it.lexile || '—'], ['Palabras', it.words], ['Género', GENRE_ES[it.genre] || it.genre], ['Fuente', link], ['Texto', 'El texto completo y las preguntas son de ReadWorks y están en inglés. La versión en español está pendiente (borrador de IA en el pipeline).']]
            : [['Grade', it.grade], ['Lexile', it.lexile || '—'], ['Words', it.words], ['Genre', it.genre], ['Source', link], ['Text', 'Full passage and question set from ReadWorks.']],
          paras: it.paras, stops: [], questions: it.questions,
        })
      }
    }
  }
}
export const FULL_LIST = Object.entries(QFULL).map(([id, it]) => ({ id, title: it.title, grade: it.grade, lexile: it.lexile }))
