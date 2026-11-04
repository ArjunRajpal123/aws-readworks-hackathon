// Comprehension questions (ReadWorks question sets). Multiple choice is scored in the page; written responses
// reveal the ReadWorks sample answer on request. Each question has neural audio that reads the question and its choices
// with the same word highlighting as the passage. Nothing here is generated at run time.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const lastAtOrBefore = (arr, t) => { let lo = 0, hi = arr.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) { a = m; lo = m + 1 } else hi = m - 1 } return a }

export function createQuestions({ t, stopPassage, voiceOn, voice }) {
  const sec = document.getElementById('qsec')
  const cache = {}
  let cur = null // { id, audio, btn, spans, raf }
  let mode = null

  async function loadAudio(id) {
    const ck = id + '|' + voice()
    if (cache[ck] !== undefined) return cache[ck]
    cache[ck] = null
    try {
      const prod = await (await fetch(`sa/product/${id}.soundAlong.json`)).json()
      const want = voice(), ok = x => x.qa && x.qa.status !== 'failed'
      const tr = prod.tracks.find(x => x.voiceId === want && ok(x)) || prod.tracks.find(x => x.default && ok(x)) || prod.tracks.find(ok)
      if (!tr) return null
      const raw = await (await fetch(`sa/${tr.timingKey}`)).arrayBuffer()
      let tm
      try { tm = JSON.parse(new TextDecoder().decode(raw)) } catch { tm = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).json() }
      if (tm.textHash !== prod.textHash) return null
      const audio = new Audio(`sa/${tr.audioKey}`)
      audio.preload = 'none'
      cache[ck] = { audio, start: tm.start, n: tm.n }
    } catch { cache[ck] = null }
    return cache[ck]
  }

  function stop() {
    if (!cur) return
    cancelAnimationFrame(cur.raf)
    cur.audio.pause()
    cur.spans.forEach(s => s.classList.remove('qon'))
    cur.btn.setAttribute('aria-pressed', 'false')
    cur.btn.querySelector('span').textContent = t('qHear')
    cur = null
  }

  async function hear(card, q, btn) {
    if (cur && cur.btn === btn) { stop(); return }
    stopPassage() // also stops any other question
    const spans = [...card.querySelectorAll('[data-qw]')]
    const a = await loadAudio(q.id)
    if (!a || a.n !== spans.length) { btn.querySelector('span').textContent = t('qNoAudio'); return }
    const au = a.audio
    cur = { id: q.id, audio: au, btn, spans, raf: 0 }
    btn.setAttribute('aria-pressed', 'true')
    btn.querySelector('span').textContent = t('qPause')
    au.currentTime = 0
    au.muted = !voiceOn()
    const frame = () => {
      if (!cur || cur.audio !== au) return
      if (au.ended) { stop(); return }
      const i = lastAtOrBefore(a.start, au.currentTime * 1000)
      spans.forEach((s, j) => s.classList.toggle('qon', j === i))
      if (i >= 0) spans[i].scrollIntoView({ block: 'nearest' })
      cur.raf = requestAnimationFrame(frame)
    }
    au.play().then(() => { cur.raf = requestAnimationFrame(frame) }).catch(() => stop())
  }

  const para = (text, base) => {
    let j = base
    const html = text.trim().split(/\s+/).map(w => `<span data-qw="${j++}">${esc(w)}</span>`).join(' ')
    return { html, next: j }
  }

  function render(m) {
    stop()
    mode = m
    const qs = m && m.questions
    sec.hidden = !qs
    if (!qs) { sec.innerHTML = ''; return }
    const mc = qs.filter(q => q.type === 0).length
    const wr = qs.length - mc
    const cards = qs.map((q, k) => {
      let j = 0
      const head = q.paras.slice(0, q.nq).map(p => { const r = para(p, j); j = r.next; return `<p class="q-p">${r.html}</p>` }).join('')
      let body = ''
      if (q.type === 0) {
        body = `<div class="q-choices" role="radiogroup" aria-labelledby="qt${k}">${q.paras.slice(q.nq).map((p, ci) => {
          const r = para(p, j); j = r.next
          return `<button type="button" class="q-choice" role="radio" aria-checked="false" data-ci="${ci}">${r.html}</button>`
        }).join('')}</div>`
      } else {
        body = `<label class="ad-sr" for="qa${k}">${t('qWrite')}</label><textarea id="qa${k}" class="q-write" rows="4" placeholder="${esc(t('qWrite'))}"></textarea>
          <button type="button" class="chipbtn q-show" data-sample="${k}">${t('qSample')}</button><div class="q-sample" id="qs${k}" hidden></div>`
      }
      return `<article class="q-card" data-k="${k}" data-type="${q.type}">
        <div class="q-top"><span class="q-num">${k + 1}</span><span class="q-kind">${t(q.type === 0 ? 'qMC' : 'qWR')}</span>
          <button type="button" class="chipbtn q-hear" aria-pressed="false" aria-label="${esc(t('qHearAria', k + 1))}"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M2 6h3l4-3v10L5 10H2z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span>${t('qHear')}</span></button></div>
        <div class="q-text" id="qt${k}">${head}</div>${body}<p class="q-fb" role="status"></p></article>`
    }).join('')
    sec.innerHTML = `<div class="q-head"><h2>${t('qTitle')}</h2><p class="q-meta">${t('qMeta', mc, wr)}</p><p class="q-score" id="qScore" role="status"></p></div>${cards}<p class="q-src">${t('qSource')}</p>`
    score()
  }

  let answered = {}
  function score() {
    const el = document.getElementById('qScore')
    if (!el || !mode || !mode.questions) return
    const mc = mode.questions.filter(q => q.type === 0).length
    const done = Object.keys(answered).length
    const ok = Object.values(answered).filter(Boolean).length
    el.textContent = mc ? t('qScore', done, mc, ok) : ''
  }

  sec.addEventListener('click', e => {
    const card = e.target.closest('.q-card'); if (!card) return
    const q = mode.questions[+card.dataset.k]
    const hearBtn = e.target.closest('.q-hear')
    if (hearBtn) { hear(card, q, hearBtn); return }
    const ch = e.target.closest('.q-choice')
    if (ch && !card.classList.contains('solved')) {
      const ci = +ch.dataset.ci
      const fb = card.querySelector('.q-fb')
      ch.setAttribute('aria-checked', 'true')
      if (ci === q.correct) {
        ch.classList.add('right'); card.classList.add('solved')
        card.querySelectorAll('.q-choice').forEach(b => { b.disabled = true })
        fb.className = 'q-fb fb ok'; fb.textContent = t('qCorrect')
        if (!(q.id in answered)) answered[q.id] = !card.dataset.missed
      } else {
        ch.classList.add('wrong'); ch.disabled = true; card.dataset.missed = '1'
        fb.className = 'q-fb fb no'; fb.textContent = t('qWrong')
        answered[q.id] = false
      }
      score(); return
    }
    const sb = e.target.closest('.q-show')
    if (sb) {
      const box = card.querySelector('.q-sample')
      if (box.hidden) { box.innerHTML = `<strong>${t('qSampleLbl')}</strong><p>${q.sample ? esc(q.sample) : t('qNoSample')}</p>`; box.hidden = false; sb.textContent = t('qHideSample') }
      else { box.hidden = true; sb.textContent = t('qSample') }
    }
  })

  return { render: m => { answered = {}; render(m) }, stop }
}
