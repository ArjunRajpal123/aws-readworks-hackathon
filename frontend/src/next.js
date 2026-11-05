// "What to read next": readings assigned by a teacher or parent, related readings, and a step up.
import { art } from './art.js'
import { byPid, related, stepUp, gradeText, titleOf } from './content.js'

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const DAY = 86400000

export function createNext({ t, getCurrent, getAssigned, getLang, onOpen }) {
  const dlg = document.createElement('dialog')
  dlg.className = 'sa-dlg nx-dlg'; dlg.id = 'nextDlg'; dlg.setAttribute('aria-labelledby', 'nxT')
  document.body.appendChild(dlg)
  dlg.addEventListener('click', e => {
    if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return }
    const b = e.target.closest('[data-pid]')
    if (b) { dlg.close(); onOpen(b.dataset.pid) }
  })
  const es = () => getLang() === 'es'
  const due = iso => { const d = Math.ceil((new Date(iso) - Date.now()) / DAY); return d <= 0 ? t('fDueToday') : d === 1 ? t('fDueTomorrow') : t('fDueIn', d) }
  const item = (e, why, extra = '') => '<li><button type="button" class="nx-item" data-pid="' + e.pid + '"><span class="fm-thumb" aria-hidden="true">' + art(e.pid) + '<img src="img/' + e.pid + '.jpg" alt="" loading="lazy" onerror="this.remove()"></span>'
    + '<span class="nx-info"><b>' + esc(titleOf(e, es())) + '</b><span class="fm-sub">' + esc(gradeText(e, es())) + ' · ' + esc(t('nxMin', e.minutes)) + (extra ? ' · ' + esc(extra) : '') + '</span><span class="nx-why">' + esc(why) + '</span></span><span class="nx-go" aria-hidden="true">›</span></button></li>'

  function count() { return getAssigned().length }
  function open() {
    const cur = getCurrent(), asg = getAssigned()
    const rel = cur ? related(cur.pid, 3) : [], up = cur ? stepUp(cur.pid) : null
    const asgItems = asg.map(a => { const e = byPid(a.pid); return e ? item(e, t('nxBy', a.byName), due(a.due)) : '' }).join('')
    dlg.innerHTML = '<button type="button" class="dlg-x" aria-label="' + esc(t('infoClose')) + '" data-close="1">×</button><h2 id="nxT">' + esc(t('nxTitle')) + '</h2>'
      + '<h3>' + esc(t('nxAssigned')) + '</h3>' + (asgItems ? '<ul class="nx-list">' + asgItems + '</ul>' : '<p class="fm-note">' + esc(t('nxNone')) + '</p>')
      + (rel.length ? '<h3>' + esc(t('nxRelated')) + '</h3><ul class="nx-list">' + rel.map(r => item(r.e, r.why.k === 'topic' ? t('nxTopic', t('tag_' + r.why.v)) : r.why.k === 'genre' ? t('nxGenre', t('genre_' + r.why.v)) : t('nxBand'))).join('') + '</ul>' : '')
      + (up ? '<h3>' + esc(t('nxChallenge')) + '</h3><ul class="nx-list">' + item(up, t('nxUp', gradeText(up, es()))) + '</ul>' : '')
    dlg.showModal(); dlg.scrollTop = 0
    const h = dlg.querySelector('#nxT'); h.tabIndex = -1; h.focus({ preventScroll: true })
  }
  return { open, count, close: () => dlg.open && dlg.close() }
}
