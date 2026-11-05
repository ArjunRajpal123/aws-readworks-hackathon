// "You finished reading" pop-up and the Rate dialog. Ratings go to the cloud
// data API (POST /api/v1/data/ratings); the admin "Feedback from students"
// panel reads them back with loadRatings(). With no API configured (local
// dev) ratings fall back to this browser's localStorage so the demo still works.
import { hasDataApi, getRatings, postRating } from './data_api.js'

const KEY = 'sa-ratings'

const localRatings = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }

// Async: returns cloud ratings when the data API is configured, else local.
export async function loadRatings() {
  if (hasDataApi()) { const r = await getRatings(); if (r) return r }
  return localRatings()
}
export function clearRatings() {
  // Cloud ratings are a durable record and are not cleared from the client;
  // this only clears any local-dev fallback and refreshes the panel.
  try { localStorage.removeItem(KEY) } catch { /* storage can be blocked */ }
  window.dispatchEvent(new Event('sa-rating'))
}
async function saveRating(r) {
  if (hasDataApi()) {
    const saved = await postRating(r)
    if (saved) { window.dispatchEvent(new Event('sa-rating')); return }
  }
  const all = localRatings(); all.push(r)
  try { localStorage.setItem(KEY, JSON.stringify(all.slice(-200))) } catch { /* storage can be blocked */ }
  window.dispatchEvent(new Event('sa-rating'))
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function createDialogs({ t, getMode, getAudioId, getVoice, onReread, onKeep, onQuestions, onWords, onNext }) {
  const done = document.createElement('dialog')
  done.className = 'sa-dlg'; done.id = 'doneDlg'; done.setAttribute('aria-labelledby', 'doneTitle')
  const rate = document.createElement('dialog')
  rate.className = 'sa-dlg'; rate.id = 'rateDlg'; rate.setAttribute('aria-labelledby', 'rateTitle')
  document.body.append(done, rate)
  for (const d of [done, rate]) d.addEventListener('click', e => { if (e.target === d) d.close() }) // tapping outside closes it

  function openDone(d = {}) {
    const m = getMode(), nq = m && m.questions ? m.questions.length : 0
    const words = d.words || [], stars = d.stars || [true, false, false], earned = stars.filter(Boolean).length
    const goals = [t('finS1'), stars[1] ? t('finS2Done') : t('finS2Todo', d.need2 || 1), stars[2] ? t('finS3Done') : t('finS3Todo')]
    const conf = Array.from({ length: 22 }, (_, i) => `<i style="left:${(i * 37) % 100}%;animation-delay:${((i * 53) % 90) / 100}s;background:${['#ffd23f', '#00a3b4', '#ff7a59', '#7b61ff', '#4cc38a'][i % 5]}"></i>`).join('')
    const nxt = (d.next || []).slice(0, 6)
    done.innerHTML = `<button type="button" class="dlg-x" aria-label="${t('dlgClose')}">×</button>
      <div class="fin-hero"><div class="fin-conf" aria-hidden="true">${conf}</div>
        <div class="fin-stars" role="img" aria-label="${esc(t('finStarsN', earned))}">${stars.map(x => `<span class="${x ? 'on' : ''}" aria-hidden="true">★</span>`).join('')}</div>
        <h2 id="doneTitle">${t('finTitle')}</h2><p>${esc(t('finSub', d.title || (m && m.title) || ''))}</p></div>
      <ul class="fin-goals">${goals.map((g, i) => `<li class="${stars[i] ? 'ok' : ''}"><span aria-hidden="true">${stars[i] ? '✓' : '○'}</span> ${esc(g)}</li>`).join('')}</ul>
      ${d.stops && d.stops[1] ? `<p class="fin-note">${esc(t('finStops', d.stops[0], d.stops[1]))}</p>` : ''}
      <div class="fin-words"><h3>${esc(t('finWords', words.length))}</h3>
        ${words.length ? `<div class="fin-chips">${words.map(w => `<span class="fin-chip">${esc(w)}</span>`).join('')}</div><p class="fin-note">${esc(t('finSaved'))} <button type="button" class="linkbtn" id="dSee">${esc(t('finSee'))}</button></p>` : `<p class="fin-note">${esc(t('finNoWords'))}</p>`}
        ${nxt.length ? `<h3>${esc(t('finNext'))}</h3><div class="fin-chips next">${nxt.map(w => `<span class="fin-chip">${esc(w)}</span>`).join('')}</div>` : ''}</div>
      <div class="dlg-stack"><button type="button" class="tbtn" id="dRe">${t('doneReread')}</button>
      <button type="button" class="tbtn" id="dKeep">${t('doneKeep')}</button>
      <button type="button" class="tbtn" id="dQ" ${nq ? '' : 'hidden'}>${t('doneQ', nq)}</button>
      <button type="button" class="tbtn" id="dNext">${t('dNext')}</button>
      <button type="button" class="tbtn dlg-alt" id="dRate">${t('doneRate')}</button></div>`
    done.querySelector('.dlg-x').onclick = () => done.close()
    done.querySelector('#dRe').onclick = () => { done.close(); onReread() }
    done.querySelector('#dKeep').onclick = () => { done.close(); onKeep() }
    done.querySelector('#dQ').onclick = () => { done.close(); onQuestions() }
    done.querySelector('#dNext').onclick = () => { done.close(); onNext && onNext() }
    done.querySelector('#dRate').onclick = () => { done.close(); openRate() }
    const see = done.querySelector('#dSee'); if (see) see.onclick = () => { done.close(); onWords && onWords() }
    if (!done.open) done.showModal()
    done.scrollTop = 0
    const h = done.querySelector('#doneTitle'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) }
  }

  function openRate() {
    const choice = (name, label, yes, no) => `<fieldset class="dlg-q"><legend>${label}</legend>
      <label><input type="radio" name="${name}" value="yes"${name === 'rHelpful' ? ' autofocus' : ''}> ${yes}</label><label><input type="radio" name="${name}" value="no"> ${no}</label></fieldset>`
    rate.innerHTML = `<button type="button" class="dlg-x" aria-label="${t('dlgClose')}">×</button><h2 id="rateTitle">${t('rateTitle')}</h2>
      ${choice('rHelpful', t('rateHelpful'), t('rateYes'), t('rateNo'))}${choice('rAudio', t('rateAudio'), t('rateGood'), t('rateBetter'))}
      <label class="dlg-c" for="rComment">${t('rateComment')}</label><textarea id="rComment" rows="3"></textarea>
      <p class="dlg-note" id="rMsg" role="status"></p>
      <div class="dlg-actions"><button type="button" class="tbtn" id="rSend">${t('rateSend')}</button><button type="button" class="chipbtn" id="rCancel">${t('rateCancel')}</button></div>
      <p class="dlg-note">${t('rateNote')}</p>`
    rate.querySelector('#rCancel').onclick = () => rate.close()
    rate.querySelector('.dlg-x').onclick = () => rate.close()
    rate.querySelector('#rSend').onclick = () => {
      const h = rate.querySelector('input[name="rHelpful"]:checked'), a = rate.querySelector('input[name="rAudio"]:checked')
      if (!h || !a) { rate.querySelector('#rMsg').textContent = t('rateNeed'); return }
      const m = getMode()
      saveRating({ passage: m ? m.id : '', audio: getAudioId(), voice: getVoice ? getVoice() : '', helpful: h.value === 'yes', audioGood: a.value === 'yes', comment: rate.querySelector('#rComment').value.trim().slice(0, 500), at: new Date().toISOString() })
      rate.innerHTML = `<button type="button" class="dlg-x" aria-label="${t('dlgClose')}">×</button><h2 id="rateTitle">${t('rateTitle')}</h2><p>${t('rateThanks')}</p><div class="dlg-actions"><button type="button" class="tbtn" id="rOk">OK</button></div>`
      rate.querySelector('#rOk').onclick = () => rate.close()
      rate.querySelector('.dlg-x').onclick = () => rate.close()
    }
    if (!rate.open) rate.showModal()
  }

  return { openDone, openRate, close: () => { if (done.open) done.close(); if (rate.open) rate.close() } }
}
