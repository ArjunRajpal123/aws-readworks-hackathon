// "How to use" walkthrough: dims the page, outlines one feature at a time, and explains it in a small card.
// Steps whose feature is not on screen (for example Questions on a passage with no questions) are skipped.
const STUDENT = [
  { sel: '#profBtn' }, { sel: '#passageSel' }, { sel: '#tabs' }, { sel: '.lngwrap' }, { sel: '#stopsBtn' }, { sel: '#audioPill' }, { sel: '.scrubwrap' },
  { sel: 'label[for="support"]' }, { sel: 'label[for="voice"]' }, { sel: '#page .w' },
  { sel: '#stopBox', narrow: '#sideTab' }, { sel: '.tsize' }, { sel: '#nextBtn' }, { sel: '#viewTabs' }, { sel: '#rateBtn' }, { sel: '#navTools' }, { sel: '#famBtn' },
]
const ADMIN = [
  { sel: '#admin .ad-seg' }, { sel: '#adText', alt: '#adFileText' }, { sel: '#adAIWrap' }, { sel: '#adForm > fieldset:nth-of-type(2)' },
  { sel: '#adForm > fieldset:nth-of-type(3)' }, { sel: '#adForm > fieldset:nth-of-type(4)' }, { sel: '.ad-sticky' },
  { sel: '#adSubmit' }, { sel: '.ad-queue' }, { sel: '#adFb' }, { sel: '#adminBtn' },
]
const FAMILY = [
  { sel: '.fm-seg', alt: '.fm-pick' }, { sel: '#fmClassTips', alt: '.fm-stats' }, { sel: '#fmStudents', alt: '.fm-subtabs' }, { sel: '.fm-wchip.hard', alt: '.fm-subtabs' }, { sel: '#famBtn' },
]
const LISTS = { student: [STUDENT, 'tourS'], admin: [ADMIN, 'tourA'], fam: [FAMILY, 'tourF'] }

export function createTour({ t, view, before }) {
  let steps = [], idx = 0, active = false, opener = null, raf = 0
  const ov = document.createElement('div'); ov.className = 'tour-ov'; ov.hidden = true
  const hl = document.createElement('div'); hl.className = 'tour-hl'
  const card = document.createElement('div'); card.className = 'tour-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-labelledby', 'tourT'); card.setAttribute('aria-describedby', 'tourB')
  ov.append(hl, card)
  document.body.appendChild(ov)

  const shown = el => { if (!el) return false; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]') }
  const narrow = () => matchMedia('(max-width: 880px)').matches
  function pick(def) {
    const list = [narrow() && def.narrow, def.sel, def.alt].filter(Boolean)
    for (const s of list) { const el = document.querySelector(s); if (shown(el)) return el }
    return null
  }
  function collect() {
    const defs = LISTS[view()][0]
    return defs.map((d, k) => ({ k, d })).filter(s => pick(s.d))
  }

  function place() {
    if (!active) return
    const s = steps[idx], el = pick(s.d)
    if (!el) { next(); return }
    const r = el.getBoundingClientRect(), pad = 6
    Object.assign(hl.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' })
    const vw = innerWidth, vh = innerHeight
    if (vw <= 700) {
      const ch2 = card.offsetHeight || 200
      const top = r.bottom + pad > vh - ch2 - 20 && r.top - pad > ch2 + 20
      card.style.cssText = top ? 'left:12px;right:12px;top:12px;bottom:auto;max-width:none' : 'left:12px;right:12px;bottom:12px;top:auto;max-width:none'
      return
    }
    const cw = Math.min(380, vw - 24), ch = card.offsetHeight || 190
    let top = r.bottom + 16
    if (top + ch > vh - 12) top = r.top - ch - 16
    if (top < 12) top = Math.max(12, Math.min(vh - ch - 12, r.top + 12))
    let left = Math.min(Math.max(12, r.left), vw - cw - 12)
    if (r.width > vw * 0.6) left = Math.max(12, (vw - cw) / 2)
    card.style.cssText = `left:${left}px;top:${top}px;width:${cw}px`
  }
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place) }

  function show() {
    const s = steps[idx], el = pick(s.d)
    if (!el) { if (idx < steps.length - 1) { idx++; show() } else stop(); return }
    const txt = t(LISTS[view()][1])[s.k] || ['', '']
    const first = idx === 0, last = idx === steps.length - 1
    card.innerHTML = `<div class="tour-n">${t('tourStep', idx + 1, steps.length)}</div><h2 id="tourT">${txt[0]}</h2><p id="tourB">${txt[1]}</p>
      <div class="tour-btns"><button type="button" class="chipbtn" id="tourSkip">${t('tourSkip')}</button><span class="tour-sp"></span>
      <button type="button" class="chipbtn" id="tourBack" ${first ? 'hidden' : ''}>${t('tourBack')}</button><button type="button" class="tbtn" id="tourNext">${last ? t('tourDone') : t('tourNext')}</button></div>`
    card.querySelector('#tourSkip').onclick = stop
    card.querySelector('#tourBack').onclick = back
    card.querySelector('#tourNext').onclick = next
    const pl = document.querySelector('#audioPill')
    if (narrow() && pl && pl.contains(el)) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
    else {
      el.scrollIntoView({ block: narrow() ? 'start' : 'center', behavior: 'auto' })
      if (narrow()) {
        // keep the target clear of the sticky player bar, and leave room for the card
        const bar = pl && pl.getBoundingClientRect().top <= 1 && getComputedStyle(pl).position === 'sticky' ? pl.getBoundingClientRect().height : 0
        window.scrollBy(0, -(bar + 12))
      }
    }
    place(); card.querySelector('#tourNext').focus({ preventScroll: true })
    setTimeout(place, 60)
  }
  function next() { if (idx >= steps.length - 1) { stop(); return } idx++; show() }
  function back() { if (idx > 0) { idx--; show() } }
  function stop() {
    active = false; ov.hidden = true
    removeEventListener('resize', schedule); removeEventListener('scroll', schedule, true); removeEventListener('keydown', onKey, true)
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
  }
  function onKey(e) {
    if (!active) return
    if (e.key === 'Escape') { e.preventDefault(); stop() }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next() }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); back() }
  }
  function start() {
    if (active) { stop(); return }
    opener = document.activeElement
    before && before()
    steps = collect(); idx = 0
    if (!steps.length) return
    active = true; ov.hidden = false
    addEventListener('resize', schedule); addEventListener('scroll', schedule, true); addEventListener('keydown', onKey, true)
    show()
  }
  return { start, stop }
}
