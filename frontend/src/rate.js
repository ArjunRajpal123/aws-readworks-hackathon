// "You finished reading" pop-up and the Rate dialog. Ratings are kept in this browser in the demo; the team's service would collect them.
const KEY = 'sa-ratings'

export function loadRatings() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
export function clearRatings() {
  try { localStorage.removeItem(KEY) } catch { /* storage can be blocked */ }
  window.dispatchEvent(new Event('sa-rating'))
}
function saveRating(r) {
  const all = loadRatings(); all.push(r)
  try { localStorage.setItem(KEY, JSON.stringify(all.slice(-200))) } catch { /* storage can be blocked */ }
  window.dispatchEvent(new Event('sa-rating'))
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function createDialogs({ t, getMode, getAudioId, getVoice, onReread, onKeep, onQuestions }) {
  const done = document.createElement('dialog')
  done.className = 'sa-dlg'; done.id = 'doneDlg'; done.setAttribute('aria-labelledby', 'doneTitle')
  const rate = document.createElement('dialog')
  rate.className = 'sa-dlg'; rate.id = 'rateDlg'; rate.setAttribute('aria-labelledby', 'rateTitle')
  document.body.append(done, rate)
  for (const d of [done, rate]) d.addEventListener('click', e => { if (e.target === d) d.close() }) // tapping outside closes it

  function openDone() {
    const m = getMode(), nq = m && m.questions ? m.questions.length : 0
    done.innerHTML = `<button type="button" class="dlg-x" aria-label="${t('dlgClose')}">×</button><h2 id="doneTitle">${t('doneTitle')}</h2><p>${t('doneText')}</p>
      <div class="dlg-stack"><button type="button" class="tbtn" id="dRe" autofocus>${t('doneReread')}</button>
      <button type="button" class="tbtn" id="dKeep">${t('doneKeep')}</button>
      <button type="button" class="tbtn" id="dQ" ${nq ? '' : 'hidden'}>${t('doneQ', nq)}</button>
      <button type="button" class="tbtn dlg-alt" id="dRate">${t('doneRate')}</button></div>`
    done.querySelector('.dlg-x').onclick = () => done.close()
    done.querySelector('#dRe').onclick = () => { done.close(); onReread() }
    done.querySelector('#dKeep').onclick = () => { done.close(); onKeep() }
    done.querySelector('#dQ').onclick = () => { done.close(); onQuestions() }
    done.querySelector('#dRate').onclick = () => { done.close(); openRate() }
    if (!done.open) done.showModal()
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
