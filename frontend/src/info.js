// Small "i" buttons that open a short explanation (what it is and what it is good for).
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function createInfo({ t }) {
  const pop = document.createElement('div')
  pop.className = 'infopop'; pop.id = 'infoPop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-labelledby', 'infoT'); pop.tabIndex = -1; pop.hidden = true
  document.body.appendChild(pop)
  let btn = null

  function content(key) {
    if (key === 'stops') return [t('infoStopsT'), t('infoStopsB')]
    if (key === 'game') return [t('infoGameT'), t('infoGameB')]
    const rows = t('modeRows')
    return [t('infoSupT'), `<p>${esc(t('infoSupIntro'))}</p><dl>${rows.map(r => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])} <span class="inf-for"><b>${esc(t('forLbl'))}:</b> ${esc(r[2])}</span></dd>`).join('')}</dl>`]
  }
  function place() {
    if (!btn) return
    if (innerWidth <= 520) { pop.style.cssText = 'left:12px;right:12px;bottom:12px;top:auto;width:auto'; return }
    const r = btn.getBoundingClientRect(), w = Math.min(380, innerWidth - 24)
    pop.style.cssText = `left:12px;top:12px;width:${w}px;bottom:auto;right:auto;max-height:${innerHeight - 24}px`
    const h = pop.offsetHeight
    let top
    if (r.bottom + 8 + h <= innerHeight - 12) top = r.bottom + 8
    else if (r.top - 8 - h >= 12) top = r.top - 8 - h
    else top = Math.max(12, innerHeight - h - 12)
    pop.style.cssText = `left:${Math.min(Math.max(12, r.left - 8), innerWidth - w - 12)}px;top:${top}px;width:${w}px;bottom:auto;right:auto;max-height:${innerHeight - 24}px`
  }
  function close(refocus = true) {
    if (pop.hidden) return
    pop.hidden = true
    if (btn) { btn.setAttribute('aria-expanded', 'false'); if (refocus && document.contains(btn)) btn.focus({ preventScroll: true }) }
    btn = null
  }
  function open(b) {
    if (btn === b && !pop.hidden) { close(); return }
    close(false)
    btn = b; b.setAttribute('aria-expanded', 'true')
    const [title, body] = content(b.dataset.info)
    pop.innerHTML = `<button type="button" class="dlg-x" aria-label="${esc(t('infoClose'))}">×</button><h3 id="infoT">${esc(title)}</h3><div class="inf-body">${body}</div>`
    pop.querySelector('.dlg-x').onclick = () => close()
    pop.hidden = false; place()
    pop.focus({ preventScroll: true })
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.info[data-info]')
    if (b) { e.preventDefault(); open(b); return }
    if (!pop.hidden && !e.target.closest('#infoPop')) close(false)
  })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); close() } }, true)
  addEventListener('resize', place)
  addEventListener('scroll', () => { if (!pop.hidden && innerWidth > 520) place() }, true)
  // Keep each i button's label in the current language.
  function label() {
    const names = { support: t('infoSupT'), stops: t('infoStopsT'), game: t('infoGameT') }
    document.querySelectorAll('.info[data-info]').forEach(b => { const n = names[b.dataset.info]; b.setAttribute('aria-label', t('infoAbout', n)); b.title = t('infoAbout', n) })
    close(false)
  }
  return { label, close }
}
