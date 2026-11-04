// Sign-in page (#signin) and the signed-in account dialog. Same layout as the admin and family
// screens: a centred page with cards (.admin / .ad-grid / .ad-card) and the app's buttons.
import { signIn, setNewPassword, currentUser } from './auth.js'

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const ROLE_ORDER = ['student', 'parent', 'teacher', 'admin']

export function createSignin({ t, onSignedIn }) {
  const root = document.getElementById('signin')
  let step = null // null | {challenge, session, email}
  let busy = false

  function roleCard() {
    return '<aside class="ad-card si-roles" aria-labelledby="siRolesH"><h2 id="siRolesH">' + esc(t('siRolesH')) + '</h2><ul class="si-rlist">'
      + ROLE_ORDER.map(r => '<li><span class="si-badge si-' + r + '">' + esc(t('role_' + r)) + '</span><span>' + esc(t('siRole_' + r)) + '</span></li>').join('')
      + '</ul><p class="ad-help">' + esc(t('siGuest')) + '</p></aside>'
  }

  function formCard() {
    if (step) {
      return '<form class="ad-card si-form" id="siForm" novalidate aria-labelledby="siFormH"><h2 id="siFormH">' + esc(t('siNewH')) + '</h2>'
        + '<p class="ad-help">' + esc(t('siNewLede', step.email)) + '</p>'
        + '<div class="ad-f"><label for="siNew">' + esc(t('siNewPw')) + '</label><input id="siNew" type="password" autocomplete="new-password" required minlength="12"></div>'
        + '<div class="ad-f"><label for="siNew2">' + esc(t('siNewPw2')) + '</label><input id="siNew2" type="password" autocomplete="new-password" required minlength="12"></div>'
        + '<p class="ad-help">' + esc(t('siPwRules')) + '</p>'
        + '<p class="si-msg" id="siMsg" role="alert"></p>'
        + '<div class="ad-actions"><button type="submit" class="ad-btn" id="siGo">' + esc(t('siSave')) + '</button>'
        + '<button type="button" class="ad-btn ad-ghost" data-si-back="1">' + esc(t('siBack')) + '</button></div></form>'
    }
    return '<form class="ad-card si-form" id="siForm" novalidate aria-labelledby="siFormH"><h2 id="siFormH">' + esc(t('siFormH')) + '</h2>'
      + '<div class="ad-f"><label for="siEmail">' + esc(t('siEmail')) + '</label><input id="siEmail" type="email" autocomplete="username" inputmode="email" required></div>'
      + '<div class="ad-f"><label for="siPw">' + esc(t('siPw')) + '</label><input id="siPw" type="password" autocomplete="current-password" required></div>'
      + '<label class="ad-check"><input type="checkbox" id="siShow"><span>' + esc(t('siShow')) + '</span></label>'
      + '<p class="si-msg" id="siMsg" role="alert"></p>'
      + '<div class="ad-actions"><button type="submit" class="ad-btn" id="siGo">' + esc(t('siGo')) + '</button>'
      + '<button type="button" class="ad-btn ad-ghost" data-si-guest="1">' + esc(t('siAsGuest')) + '</button></div>'
      + '<p class="ad-help">' + esc(t('siHelp')) + '</p></form>'
  }

  function render() {
    root.innerHTML = '<div class="ad-head"><h1>' + esc(t('siTitle')) + '</h1><p class="ad-lede">' + esc(t('siLede')) + '</p></div>'
      + '<div class="ad-grid si-grid">' + formCard() + roleCard() + '</div>'
    const first = root.querySelector(step ? '#siNew' : '#siEmail')
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 0)
  }

  const msg = s => { const m = root.querySelector('#siMsg'); if (m) m.textContent = s || '' }
  function setBusy(on) {
    busy = on
    const b = root.querySelector('#siGo'); if (b) { b.disabled = on; b.textContent = on ? t('siWorking') : t(step ? 'siSave' : 'siGo') }
  }

  root.addEventListener('submit', async e => {
    e.preventDefault()
    if (busy) return
    if (step) {
      const a = root.querySelector('#siNew').value, b = root.querySelector('#siNew2').value
      if (a !== b) { msg(t('siMismatch')); return }
      setBusy(true)
      try { await setNewPassword(step, a); step = null; done() } catch (err) { msg(err.message) } finally { setBusy(false) }
      return
    }
    const email = root.querySelector('#siEmail').value, pw = root.querySelector('#siPw').value
    if (!email.trim() || !pw) { msg(t('siNeed')); return }
    setBusy(true)
    try {
      const r = await signIn(email, pw)
      if (r.challenge) { step = r; render(); return }
      done()
    } catch (err) { msg(err.message) } finally { setBusy(false) }
  })
  root.addEventListener('change', e => {
    if (e.target.id === 'siShow') root.querySelector('#siPw').type = e.target.checked ? 'text' : 'password'
  })
  root.addEventListener('click', e => {
    if (e.target.closest('[data-si-back]')) { step = null; render() }
    if (e.target.closest('[data-si-guest]')) onSignedIn(null)
  })

  function done() { root.innerHTML = ''; onSignedIn(currentUser()) }

  return { render, reset() { step = null } }
}

// Account dialog for a signed-in user: who you are, your role, Sign out. Admins can also view the
// app as any person (the existing "Who is reading?" picker).
export function createAccount({ t, onSignOut, onViewAs }) {
  const dlg = document.createElement('dialog')
  dlg.className = 'sa-dlg pf-dlg'; dlg.id = 'acctDlg'; dlg.setAttribute('aria-labelledby', 'acT')
  document.body.appendChild(dlg)
  function open(viewingAs) {
    const u = currentUser(); if (!u) return
    dlg.innerHTML = '<button type="button" class="dlg-x" aria-label="' + esc(t('infoClose')) + '" data-close="1">×</button>'
      + '<h2 id="acT">' + esc(t('acTitle')) + '</h2>'
      + '<div class="si-who"><span class="pf-av pf-' + esc(u.role || 'guest') + '" aria-hidden="true">' + esc(u.name.split(/[\s@]/).filter(Boolean).map(x => x[0]).slice(0, 2).join('').toUpperCase()) + '</span>'
      + '<span><b>' + esc(u.name) + '</b><span class="fm-sub">' + esc(u.email) + '</span></span></div>'
      + '<p><span class="si-badge si-' + esc(u.role || 'none') + '">' + esc(u.role ? t('role_' + u.role) : t('role_none')) + '</span> ' + esc(u.role ? t('siRole_' + u.role) : t('acNoRole')) + '</p>'
      + (u.role !== 'admin' && !u.personId && u.role ? '<p class="ad-help">' + esc(t('acNoPerson')) + '</p>' : '')
      + (u.role === 'admin' && viewingAs ? '<p class="ad-help">' + esc(t('acViewing', viewingAs)) + '</p>' : '')
      + '<div class="dlg-actions">' + (u.role === 'admin' ? '<button type="button" class="chipbtn" data-viewas="1">' + esc(t('acViewAs')) + '</button>' : '')
      + '<button type="button" class="tbtn" data-signout="1">' + esc(t('acSignOut')) + '</button></div>'
    dlg.showModal()
  }
  dlg.addEventListener('click', e => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close()
    else if (e.target.closest('[data-signout]')) { dlg.close(); onSignOut() }
    else if (e.target.closest('[data-viewas]')) { dlg.close(); onViewAs() }
  })
  return { open }
}
