// Admin screen: submit new content for the pipeline. With the API configured (window.SA_API_URL), a pasted or
// read-from-file passage is sent to POST /api/v1/text-to-speech and opens in the player when it's done. Everything
// else (ReadWorks IDs, bulk CSVs, translation, cards, Word Stops, review) is still a demo: the "request" shown on
// the right is the shape the team's pipeline would receive, and the queue progress is simulated.
import { detect, aiSuggest } from './assist.js'
import { createProduct } from './api.js'
import { postReview, translate, genCards, genStops, localizeCards, putPassageCards, deletePassage } from './data_api.js'
import { RW_KNOWN } from './vocab_db.js'
import { loadRatings, clearRatings } from './rate.js'

const STORE = 'sa-admin-queue'
const BANDS = [['k2', 'K-2'], ['35', '3-5'], ['68', '6-8'], ['912', '9-12']]
const STAGE_MS = 1400
const API_MAX_CHARS = 3000 // POST /api/v1/text-to-speech limit (lambda/text_to_speech_post/handler.py)

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const words = s => (s.trim() ? s.trim().split(/\s+/).length : 0)
const sizeLabel = n => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB')

const TEMPLATE = `
<div class="ad-head">
  <h1 data-i18n="adTitle">Add content</h1>
  <p class="ad-lede" data-i18n="adLede"></p>
</div>
<div class="ad-grid">
<form class="ad-form" id="adForm" novalidate>

<fieldset class="ad-card"><legend data-i18n="adS1">1. Content</legend>
  <div class="ad-seg" role="radiogroup" aria-labelledby="adMethodLbl">
    <span id="adMethodLbl" class="ad-sr" data-i18n="adMethod"></span>
    <label><input type="radio" name="adMethod" value="paste" checked><span data-i18n="adMPaste"></span></label>
    <label><input type="radio" name="adMethod" value="file"><span data-i18n="adMFile"></span></label>
    <label><input type="radio" name="adMethod" value="rw"><span data-i18n="adMRW"></span></label>
    <label><input type="radio" name="adMethod" value="bulk"><span data-i18n="adMBulk"></span></label>
  </div>

  <div class="ad-pane" data-pane="paste">
    <label for="adText" data-i18n="adTextLbl"></label>
    <textarea id="adText" rows="9"></textarea>
    <div class="ad-textfoot"><p class="ad-help"><span id="adCount"></span> · <span data-i18n="adTextHelp"></span></p>
      <div class="ad-aislot" id="adAISlot"><div id="adAIWrap"><button type="button" class="ad-btn ad-ai-btn" id="adAI"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6zM13 11l.7 1.8 1.8.7-1.8.7L13 16l-.7-1.8-1.8-.7 1.8-.7z"/></svg><span data-i18n="adAI"></span></button><p class="ad-help ad-aimsg" id="adAIMsg" role="status"></p></div></div></div>
  </div>

  <div class="ad-pane" data-pane="file" hidden>
    <label class="ad-drop" id="adDrop" for="adFiles"><span data-i18n="adDrop"></span></label>
    <input id="adFiles" class="ad-sr" type="file" multiple accept=".txt,.md,.html,.htm,.json,.docx,.pdf,.rtf">
    <p class="ad-help" data-i18n="adFileHelp"></p>
    <ul class="ad-files" id="adFileList"></ul>
    <label for="adFileText" data-i18n="adTextLbl"></label>
    <textarea id="adFileText" rows="6" placeholder=""></textarea>
    <div class="ad-textfoot"><span></span><div class="ad-aislot" id="adAISlotFile"></div></div>
  </div>

  <div class="ad-pane" data-pane="rw" hidden>
    <label for="adRWUrl" data-i18n="adRWLbl"></label>
    <input id="adRWUrl" type="text" autocomplete="off" placeholder="https://www.readworks.org/article/…/2b781dab-4521-40d2-a9b6-ad5f2bb0ba98">
    <p class="ad-help" id="adRWMsg"></p>
    <p class="ad-help" data-i18n="adRWHelp"></p>
  </div>

  <div class="ad-pane" data-pane="bulk" hidden>
    <label for="adBulk" data-i18n="adBulkLbl"></label>
    <input id="adBulk" type="file" accept=".csv,.zip">
    <p class="ad-help" id="adBulkMsg"></p>
    <p class="ad-help" data-i18n="adBulkHelp"></p>
    <button type="button" class="ad-btn ad-ghost" id="adTemplate" data-i18n="adTemplate"></button>
  </div>
  <div class="ad-detect" id="adDetect" aria-live="polite" hidden></div>
</fieldset>

<fieldset class="ad-card"><legend data-i18n="adS2">2. About the passage</legend>
  <div class="ad-row">
    <div class="ad-f ad-wide"><label for="adTitle" data-i18n="adTitleLbl"></label><input id="adTitle" type="text" autocomplete="off"></div>
    <div class="ad-f"><label for="adAuthor" data-i18n="adAuthor"></label><input id="adAuthor" type="text" autocomplete="off"></div>
    <div class="ad-f"><label for="adSrcLang" data-i18n="adSrcLang"></label>
      <select id="adSrcLang"><option value="" data-i18n="adChoose"></option><option value="en-US" data-i18n="adLEn"></option><option value="es-US" data-i18n="adLEs"></option></select></div>
    <div class="ad-f"><label for="adBand" data-i18n="adBand"></label>
      <select id="adBand"><option value="" data-i18n="adChoose"></option><option value="k2">K-2</option><option value="35">3-5</option><option value="68">6-8</option><option value="912">9-12</option></select></div>
    <div class="ad-f"><label for="adGrade" data-i18n="adGrade"></label>
      <select id="adGrade"><option value="">—</option><option>K</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option>6</option><option>7</option><option>8</option><option>9</option><option>10</option><option>11</option><option>12</option></select></div>
    <div class="ad-f"><label for="adLexile" data-i18n="adLexile"></label><input id="adLexile" type="text" inputmode="numeric" placeholder="590L"></div>
    <div class="ad-f"><label for="adGenre" data-i18n="adGenre"></label>
      <select id="adGenre"><option value="fiction" data-i18n="gFic"></option><option value="nonfiction" data-i18n="gNon"></option><option value="poetry" data-i18n="gPoe"></option><option value="drama" data-i18n="gDra"></option><option value="other" data-i18n="gOth"></option></select></div>
    <div class="ad-f"><label for="adTopic" data-i18n="adTopic"></label><input id="adTopic" type="text" autocomplete="off"></div>
    <div class="ad-f"><label for="adRWId" data-i18n="adRWId"></label><input id="adRWId" type="text" autocomplete="off"></div>
    <div class="ad-f"><label for="adPaired" data-i18n="adPaired"></label><input id="adPaired" type="text" autocomplete="off"></div>
    <div class="ad-f ad-wide"><label for="adRights" data-i18n="adRights"></label>
      <select id="adRights"><option value="readworks" data-i18n="rRW"></option><option value="public-domain" data-i18n="rPD"></option><option value="licensed" data-i18n="rLic"></option><option value="other" data-i18n="rOth"></option></select></div>
  </div>
  <label class="ad-check"><input type="checkbox" id="adRightsOk"><span data-i18n="adRightsOk"></span></label>
</fieldset>

<fieldset class="ad-card"><legend data-i18n="adS3">3. What the pipeline should do</legend>
  <div class="ad-opt"><label class="ad-check"><input type="checkbox" checked disabled><span data-i18n="adTok"></span></label><p class="ad-help" data-i18n="adTokH"></p></div>
  <div class="ad-opt"><label class="ad-check"><input type="checkbox" id="adAud" checked><span data-i18n="adAud"></span></label><p class="ad-help" data-i18n="adAudH"></p>
    <div class="ad-sub"><label class="ad-check"><input type="checkbox" id="adAudEn" checked><span data-i18n="adAudEn"></span></label>
    <label class="ad-check"><input type="checkbox" id="adAudEs" checked><span data-i18n="adAudEs"></span></label></div></div>
  <div class="ad-opt"><label class="ad-check"><input type="checkbox" id="adTrans" checked><span data-i18n="adTrans"></span></label><p class="ad-help" data-i18n="adTransH"></p></div>
  <div class="ad-opt"><label class="ad-check"><input type="checkbox" id="adCards" checked><span data-i18n="adCards"></span></label><p class="ad-help" data-i18n="adCardsH"></p></div>
  <div class="ad-opt"><label class="ad-check"><input type="checkbox" id="adStops" checked><span data-i18n="adStops"></span></label>
    <div class="ad-sub" role="group" aria-label="Grade bands">${BANDS.map(([v, l]) => `<label class="ad-check"><input type="checkbox" name="adBands" value="${v}" checked><span>${l}</span></label>`).join('')}</div></div>
  <div class="ad-opt"><label class="ad-check"><input type="checkbox" id="adStopAud" checked><span data-i18n="adStopAud"></span></label><p class="ad-help" data-i18n="adStopAudH"></p></div>
  <div class="ad-opt"><label class="ad-check"><input type="checkbox" id="adPics"><span data-i18n="adPics"></span></label><p class="ad-help" data-i18n="adPicsH"></p></div>
  <div class="ad-opt"><label for="adQsSrc" data-i18n="adQs"></label>
    <select id="adQsSrc"><option value="readworks-import" data-i18n="adQsRW"></option><option value="upload" data-i18n="adQsUp"></option><option value="ai-draft" data-i18n="adQsAI"></option><option value="none" data-i18n="adQsNone"></option></select>
    <p class="ad-help" data-i18n="adQsH"></p>
    <label class="ad-check"><input type="checkbox" id="adQsAud" checked><span data-i18n="adQsAud"></span></label>
    <label class="ad-check"><input type="checkbox" id="adQsEv"><span data-i18n="adQsEv"></span></label></div>
  <div class="ad-opt"><label for="adLex" data-i18n="adLex"></label><textarea id="adLex" rows="3" placeholder="Hunsford = HUNZ-ferd"></textarea><p class="ad-help" data-i18n="adLexH"></p></div>
  <div class="ad-opt"><label for="adHuman" data-i18n="adHuman"></label><input id="adHuman" type="file" accept=".mp3,audio/mpeg"><p class="ad-help" data-i18n="adHumanH"></p></div>
</fieldset>

<fieldset class="ad-card"><legend data-i18n="adS4">4. Review and publish</legend>
  <div class="ad-opt" role="radiogroup" aria-label="Review mode">
    <label class="ad-check"><input type="radio" name="adRev" value="required" checked><span data-i18n="adRevReq"></span></label>
    <label class="ad-check"><input type="radio" name="adRev" value="auto"><span data-i18n="adRevAuto"></span></label>
  </div>
  <div class="ad-row">
    <div class="ad-f"><label for="adRevers" data-i18n="adRevers"></label><input id="adRevers" type="text" autocomplete="off"></div>
    <div class="ad-f"><label for="adRevEs" data-i18n="adRevEs"></label><input id="adRevEs" type="text" autocomplete="off"></div>
    <div class="ad-f"><label for="adDue" data-i18n="adDue"></label><input id="adDue" type="date"></div>
    <div class="ad-f"><label for="adVis" data-i18n="adVis"></label>
      <select id="adVis"><option value="draft" data-i18n="adVDraft"></option><option value="staging" data-i18n="adVStage"></option><option value="published" data-i18n="adVPub"></option></select></div>
    <div class="ad-f"><label for="adBatch" data-i18n="adBatch"></label><input id="adBatch" type="text" autocomplete="off"></div>
    <div class="ad-f"><label for="adEmail" data-i18n="adNotify"></label><input id="adEmail" type="email" autocomplete="off" placeholder="name@example.org"></div>
    <div class="ad-f ad-wide"><label for="adNotes" data-i18n="adNotes"></label><textarea id="adNotes" rows="3"></textarea></div>
  </div>
</fieldset>
</form>

<aside class="ad-side" aria-live="polite">
  <div class="ad-card ad-sticky">
    <h2 data-i18n="adSum">Submission summary</h2>
    <dl class="ad-dl" id="adStats"></dl>
    <p class="ad-help" data-i18n="adEstNote"></p>
    <div id="adMissing" class="ad-missing"></div>
    <div class="ad-actions">
      <button type="button" class="ad-btn" id="adSubmit" data-i18n="adSubmit"></button>
      <button type="button" class="ad-btn ad-ghost" id="adDry" data-i18n="adDry"></button>
    </div>
    <p class="ad-help" id="adMsg"></p>
    <details class="ad-pay"><summary data-i18n="adPayload"></summary>
      <button type="button" class="ad-btn ad-ghost ad-small" id="adCopy" data-i18n="adCopy"></button>
      <pre id="adPayload"></pre></details>
  </div>
</aside>
</div>

<section class="ad-card ad-queue" aria-labelledby="adQH">
  <div class="ad-qhead"><h2 id="adQH" data-i18n="adQ">Queue</h2><button type="button" class="ad-btn ad-ghost ad-small" id="adClear" data-i18n="adClear"></button></div>
  <div id="adQueue"></div>
</section>

<section class="ad-card ad-queue" aria-labelledby="adFbH">
  <div class="ad-qhead"><h2 id="adFbH" data-i18n="adFb">Feedback from students</h2><span class="ad-help" data-i18n="adFbNote"></span><button type="button" class="ad-btn ad-ghost ad-small" id="adFbClear" data-i18n="adFbClear"></button></div>
  <div id="adFb"></div>
</section>
`

export function initAdmin(t) {
  const root = document.getElementById('admin')
  root.innerHTML = TEMPLATE
  const $ = s => root.querySelector(s)
  const $$ = s => [...root.querySelectorAll(s)]
  const val = id => ($('#' + id).value || '').trim()
  const on = id => $('#' + id).checked

  let files = []        // File objects chosen in the file pane
  let fileTexts = []    // text read from those files
  let bulkRows = null   // rows counted in a CSV
  let jsonMeta = null   // details read from an uploaded ReadWorks passage record
  let queue = []
  try { queue = JSON.parse(localStorage.getItem(STORE) || '[]') } catch { queue = [] }
  // An API request still pending when the page closed never got its answer back.
  for (const e of queue) if (e.api) { e.api = false; e.state = 'error'; e.error = 'Page closed before the API answered' }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(queue)) } catch { /* storage can be blocked */ } }

  const method = () => $('input[name="adMethod"]:checked').value
  const bands = () => $$('input[name="adBands"]:checked').map(i => i.value)

  function currentText() {
    if (method() === 'paste') return $('#adText').value
    if (method() === 'file') return $('#adFileText').value
    return ''
  }
  function rwId() {
    const m = val('adRWUrl').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    return m ? m[0].toLowerCase() : ''
  }
  function itemCount() {
    if (method() === 'file') return Math.max(files.length, currentText().trim() ? 1 : 0)
    if (method() === 'bulk') return bulkRows ?? ($('#adBulk').files[0] ? 1 : 0)
    return method() === 'rw' ? (rwId() ? 1 : 0) : (currentText().trim() ? 1 : 0)
  }
  function audioLangs() {
    if (!on('adAud')) return []
    return [on('adAudEn') && 'en-US', on('adAudEs') && 'es-US'].filter(Boolean)
  }
  // Polly neural list price (from the build pack): $16 per 1M characters for speech and $16 for speech marks.
  // A translated version is assumed to be about 15% longer; this is an estimate, not a measurement.
  function estimate() {
    const text = method() === 'file' && !currentText().trim() ? fileTexts.join('\n') : currentText()
    const chars = text.length
    if (!chars) return null
    const src = val('adSrcLang') || 'en-US'
    const langs = audioLangs()
    const total = langs.reduce((n, l) => n + (l === src ? chars : chars * 1.15), 0)
    return { chars, words: words(text), audioChars: Math.round(total), usd: total * 32 / 1e6 }
  }
  function missing() {
    const m = []
    const text = method() === 'file' && !currentText().trim() ? fileTexts.join('') : currentText()
    const hasSource = method() === 'rw' ? !!rwId() : method() === 'bulk' ? !!$('#adBulk').files[0] : method() === 'file' ? (files.length > 0 || text.trim().length > 0) : text.trim().length >= 40
    if (!hasSource) m.push('mText')
    if (method() !== 'bulk') {
      if (!val('adTitle') && method() !== 'rw') m.push('mTitle')
      if (!val('adSrcLang') && method() !== 'rw') m.push('mLang')
      if (!val('adBand')) m.push('mBand')
    }
    if (!on('adRightsOk')) m.push('mRights')
    return m
  }
  function payload() {
    const est = estimate()
    const stages = { tokenize: true }
    if (on('adAud')) stages.audio = { engine: 'polly-neural', languages: audioLangs(), voices: { 'en-US': ['Danielle', 'Stephen'], 'es-US': ['Lupe', 'Pedro'] } }
    if (on('adTrans')) stages.otherLanguage = { mode: 'ai-draft', reviewRequired: true }
    if (on('adCards')) {
      const words = [...(det && det.vocab ? det.vocab.map(v => ({ word: v.word, source: 'database' })) : []), ...keptVocab().map(w => ({ word: w, source: 'ai-suggested', needsReview: true }))]
      stages.vocabularyCards = { languages: ['en-US', 'es-US'], ...(words.length ? { words } : {}) }
    }
    const qsrc = val('adQsSrc')
    if (on('adStops')) stages.wordStops = { bands: bands(), audio: on('adStopAud'), pictureChoices: on('adPics') }
    const questions = qsrc === 'none' ? { source: 'none' } : { source: qsrc, audio: on('adQsAud'), evidenceHighlight: on('adQsEv') }
    const lex = val('adLex').split('\n').map(l => l.split('=')).filter(p => p.length === 2).map(([w, s]) => ({ word: w.trim(), say: s.trim() }))
    if (lex.length) stages.pronunciation = lex
    if ($('#adHuman').files[0]) stages.humanAudio = { file: $('#adHuman').files[0].name, timing: 'forced-alignment' }
    const text = currentText()
    return {
      batchLabel: val('adBatch') || undefined,
      input: {
        method: method(),
        files: method() === 'file' ? files.map(f => ({ name: f.name, bytes: f.size, type: f.type || 'unknown' })) : undefined,
        bulkFile: method() === 'bulk' && $('#adBulk').files[0] ? $('#adBulk').files[0].name : undefined,
        readworksId: method() === 'rw' ? rwId() || undefined : undefined,
        textPreview: text ? text.slice(0, 80) + (text.length > 80 ? '…' : '') : undefined,
        characters: est ? est.chars : undefined,
      },
      passage: {
        title: val('adTitle') || undefined, author: val('adAuthor') || undefined, language: val('adSrcLang') || undefined,
        gradeBand: val('adBand') || undefined, grade: val('adGrade') || undefined, lexile: val('adLexile') || undefined,
        genre: val('adGenre'), topic: val('adTopic') || undefined, readworksId: val('adRWId') || undefined, pairedPassageId: val('adPaired') || undefined,
        rights: { source: val('adRights'), confirmed: on('adRightsOk') },
      },
      pipeline: stages,
      questions,
      assist: assistInfo(),
      review: { mode: $('input[name="adRev"]:checked').value, reviewers: val('adRevers') || undefined, spanishReviewer: val('adRevEs') || undefined, dueDate: val('adDue') || undefined, afterApproval: val('adVis'), notifyEmail: val('adEmail') || undefined, notes: val('adNotes') || undefined },
      estimate: est ? { audioCharacters: est.audioChars, pollyListPriceUSD: +est.usd.toFixed(2), note: 'AI generation and Word Stop audio not estimated' } : undefined,
    }
  }

  function stagesFor(p) {
    const s = ['stQueued', 'stTok']
    if (p.pipeline.audio) s.push('stAud')
    if (p.pipeline.otherLanguage) s.push('stTrans')
    if (p.pipeline.vocabularyCards) s.push('stCards')
    if (p.pipeline.wordStops) s.push('stStops')
    if (p.questions && p.questions.source !== 'none') s.push('stQs')
    s.push('stChecks')
    return s
  }

  function renderSummary() {
    const est = estimate()
    const items = itemCount()
    const langs = audioLangs().map(l => (l === 'en-US' ? t('adLEn') : t('adLEs'))).join(', ') || t('adBulkNone')
    $('#adStats').innerHTML = `
      <div><dt>${t('adItems')}</dt><dd>${items || '—'}</dd></div>
      <div><dt>${t('adWords')}</dt><dd>${est ? est.words.toLocaleString() : '—'}</dd></div>
      <div><dt>${t('adChars')}</dt><dd>${est ? est.chars.toLocaleString() : '—'}</dd></div>
      <div><dt>${t('adLangs')}</dt><dd>${esc(langs)}</dd></div>
      <div><dt>${t('adEst')}</dt><dd>${est ? '$' + est.usd.toFixed(2) : '<span class="ad-help">' + t('adNoEst') + '</span>'}</dd></div>`
    const miss = missing()
    $('#adMissing').innerHTML = miss.length
      ? `<strong>${t('adMissing')}</strong><ul>${miss.map(k => `<li>${t(k)}</li>`).join('')}</ul>`
      : `<strong class="ad-ok">✓ ${t('adReady')}</strong>`
    $('#adSubmit').disabled = miss.length > 0
    $('#adPayload').textContent = JSON.stringify(payload(), null, 2)
    $('#adCount').textContent = t('adCount', words($('#adText').value), $('#adText').value.length)
  }

  function stageLabel(e) {
    if (e.state === 'error') return t('stFail')
    if (e.state === 'review') return t('stReview')
    if (e.state === 'done') return t(e.vis === 'published' ? 'stPub' : e.vis === 'staging' ? 'stStage' : 'stDraft')
    return t(e.stages[Math.min(e.at, e.stages.length - 1)])
  }
  // "EN · ES ✓": the source language, then the generated other language and how it went.
  function langLine(e) {
    if (e.langs) return e.langs // rows saved before both-language passages
    const other = e.src === 'es' ? 'en' : 'es'
    const mark = { pending: ' …', done: ' ✓', error: ' ✗' }[e.other] || ''
    return e.src.toUpperCase() + (e.both ? ' + ' + other.toUpperCase() + mark : '')
  }
  function renderQueue() {
    const q = $('#adQueue')
    $('#adClear').hidden = queue.length === 0
    if (!queue.length) { q.innerHTML = `<p class="ad-help">${t('adQEmpty')}</p>`; return }
    q.innerHTML = `<div class="ad-tw"><table><thead><tr><th>${t('adColPass')}</th><th>${t('adColStatus')}</th><th>${t('adColProg')}</th><th>${t('adColAct')}</th></tr></thead><tbody>${queue.map(e => {
      const total = e.stages.length
      const pct = e.state === 'running' ? Math.round(100 * e.at / total) : 100
      return `<tr><td><strong>${esc(e.title)}</strong><br><span class="ad-help">${esc(langLine(e))} · ${esc(e.band)} · ${esc(e.time)}</span>${e.error ? `<br><span class="ad-help">${esc(e.error)}</span>` : ''}</td>
        <td><span class="ad-pill ad-${e.state}">${stageLabel(e)}</span></td>
        <td><div class="ad-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div></td>
        <td class="ad-acts">${e.state === 'review' ? `<button type="button" class="ad-btn ad-small" data-act="approve" data-id="${e.id}">${t('adApprove')}</button>` : ''}${e.pid && e.state !== 'running' && e.state !== 'error' ? `<a class="ad-btn ad-small" href="?m=${encodeURIComponent(e.pid)}">${t('adOpen')}</a>` : ''}<button type="button" class="ad-btn ad-ghost ad-small" data-act="remove" data-id="${e.id}">${t('adRemove')}</button></td></tr>`
    }).join('')}</tbody></table></div>`
  }
  // ---- form assist: fill in what the text already tells us, and optionally ask AI ----
  const FILL = ['adSrcLang', 'adBand', 'adGrade', 'adTitle', 'adAuthor', 'adGenre', 'adLexile', 'adTopic', 'adRWId', 'adRights', 'adTrans']
  const BAND = { k2: 'K-2', 35: '3-5', 68: '6-8', 912: '9-12' }
  const touched = new Set(), auto = new Map() // field id -> 'det' (from the text) or 'ai'
  let det = null, aiVocab = [], aiUsed = null, detTimer = 0
  const aiDismissed = new Set() // lowercased AI vocab words the admin removed
  const sourceText = () => (method() === 'file' && !currentText().trim() ? fileTexts.join('\n\n') : currentText())
  function badge(id, kind) {
    const lab = root.querySelector(`label[for="${id}"]`); if (!lab) return
    lab.querySelectorAll('.ad-badge').forEach(b => b.remove())
    if (kind) lab.insertAdjacentHTML('beforeend', ` <span class="ad-badge ad-b-${kind}">${t(kind === 'ai' ? 'adBadgeAI' : 'adBadgeDet')}</span>`)
  }
  function setField(id, value, kind) {
    if (!value || touched.has(id)) return false
    const el = $('#' + id); if (!el) return false
    if (kind === 'ai' && auto.get(id) === 'det') return false
    if (el.value && !auto.has(id) && el.tagName !== 'SELECT') return false
    if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === String(value))) return false
    el.value = String(value); auto.set(id, kind); badge(id, kind); return true
  }
  function applyDetected() {
    const k = det.known
    setField('adSrcLang', det.lang, 'det'); setField('adBand', det.band, 'det')
    if (det.grade != null) setField('adGrade', det.grade === 0 ? 'K' : String(det.grade), 'det')
    setField('adTitle', k ? k.title : det.titleGuess, 'det')
    if (k) {
      setField('adAuthor', k.author, 'det'); setField('adGenre', k.genre, 'det'); setField('adLexile', k.lexile, 'det')
      setField('adRWId', k.uuid, 'det'); setField('adRights', 'readworks', 'det'); setField('adGrade', k.grade, 'det'); setField('adBand', '35', 'det')
    }
    if (jsonMeta) { setField('adTitle', jsonMeta.title, 'det'); setField('adAuthor', jsonMeta.author, 'det'); setField('adRWId', jsonMeta.uuid, 'det'); setField('adLexile', jsonMeta.lexile, 'det') }
  }
  function runDetect() {
    if (method() === 'rw') {
      const k = RW_KNOWN.find(p => p.uuid === rwId())
      det = k ? { known: k, lang: 'en-US', confidence: 1, words: 0, sentences: 0, grade: null, band: '35', vocab: k.vocab.map(w => ({ word: w, source: 'ReadWorks · ' + k.title })) } : null
    } else if (method() === 'bulk') det = null
    else det = detect(sourceText(), method() === 'file' && files[0] ? files[0].name : '')
    if (det) applyDetected()
    render()
  }
  function renderDetect() {
    const box = $('#adDetect'); if (!box) return
    for (const [id, k] of auto) badge(id, k)
    if (!det) { box.hidden = !aiVocab.length; box.innerHTML = aiVocab.length ? aiBlock() : ''; return }
    const chips = det.vocab.map(v => `<span class="ad-chip" title="${esc(v.source)}">${esc(v.word)}</span>`).join(' ')
    const lang = det.lang === 'es-US' ? t('adLangEsName') : t('adLangEnName')
    box.hidden = false
    box.innerHTML = `<div class="ad-det-h"><strong>${t('adDetTitle')}</strong><button type="button" class="ad-btn ad-ghost ad-small" id="adUndo">${t('adDetUndo')}</button></div><ul>
      <li>${t('adDetLang', lang)}${det.known ? '' : ` (${Math.round(det.confidence * 100)}%)`}</li>
      ${det.words ? `<li>${t('adDetWords', det.words.toLocaleString(), det.sentences)}</li>` : ''}
      ${det.grade != null && !det.known ? `<li>${t('adDetLevel', det.grade === 0 ? 'K' : det.grade, BAND[det.band])}</li>` : ''}
      ${det.known ? `<li>${t('adDetKnown', esc(det.known.title), det.known.id)}</li>` : ''}
      <li>${det.vocab.length ? t('adDetVocab', det.vocab.length, '') + '<div class="ad-chips">' + chips + '</div>' : t('adDetNoVocab')}</li></ul>${aiVocab.length ? aiBlock() : ''}`
  }
  // AI vocab words with a per-word Keep/Remove toggle; only kept words flow to
  // the submission. aiDismissed holds the lowercased words the admin removed.
  const keptVocab = () => aiVocab.filter(w => !aiDismissed.has(w.toLowerCase()))
  const aiBlock = () => {
    const kept = keptVocab().length
    return `<div class="ad-vhead-row"><p class="ad-help">${t('adAIFor')}</p><span class="ad-help">${t('adVocabKept', kept, aiVocab.length)}</span></div>
      <div class="ad-chips">${aiVocab.map(w => {
        const off = aiDismissed.has(w.toLowerCase())
        return `<button type="button" class="ad-chip ad-chip-ai ad-vchip${off ? ' ad-vchip-off' : ''}" data-vocab="${esc(w)}" aria-pressed="${!off}">${esc(w)}${off ? ' +' : ' ×'}</button>`
      }).join(' ')}</div>`
  }
  function undoFill() {
    for (const [id] of auto) {
      const el = $('#' + id); if (!el) continue
      el.value = id === 'adGenre' ? 'fiction' : id === 'adRights' ? 'readworks' : ''
      badge(id, null)
    }
    auto.clear(); aiVocab = []; aiDismissed.clear(); aiUsed = null; det = det && { ...det, known: null }; $('#adAIMsg').textContent = ''; render()
  }
  function assistInfo() {
    const filled = [...auto].filter(([, k]) => k === 'det').map(([i]) => i)
    return {
      detected: det ? { language: det.lang, estimatedGrade: det.grade == null ? undefined : det.grade, estimatedBand: det.grade == null ? undefined : det.band, matchedReadWorksId: det.known ? det.known.id : undefined, vocabularyFound: det.vocab.length, fieldsFilled: filled } : undefined,
      ai: aiUsed || { used: false },
    }
  }
  const aiDlg = document.createElement('dialog'); aiDlg.className = 'sa-dlg'; aiDlg.id = 'adAIDlg'; root.appendChild(aiDlg)
  function openAI() {
    if (sourceText().trim().length < 40) { $('#adAIMsg').textContent = t('adAINeed'); return }
    aiDlg.innerHTML = `<button type="button" class="dlg-x" aria-label="${t('dlgClose')}">×</button><h2>${t('adAIDlgT')}</h2><ul class="dlg-list"><li>${t('adAIDlgB1')}</li><li>${t('adAIDlgB2')}</li><li>${t('adAIDlgB3')}</li></ul>
      <div class="dlg-actions"><button type="button" class="tbtn" id="adAIGo" autofocus>${t('adAIUse')}</button><button type="button" class="chipbtn" id="adAINo">${t('adAICancel')}</button></div>`
    aiDlg.querySelector('#adAINo').onclick = () => aiDlg.close()
    aiDlg.querySelector('.dlg-x').onclick = () => aiDlg.close()
    aiDlg.onclick = e => { if (e.target === aiDlg) aiDlg.close() }
    aiDlg.querySelector('#adAIGo').onclick = () => { aiDlg.close(); runAI() }
    aiDlg.showModal()
  }
  async function runAI() {
    const btn = $('#adAI'), lab = btn.querySelector('span'), label = lab.textContent
    btn.disabled = true; lab.textContent = t('adAIWorking')
    try {
      const text = sourceText(), d = det || detect(text) || { lang: 'en-US' }
      // Cheap, local adequacy check before filling (keeps cost at zero): enough
      // words and looks like sentences. Brief feedback; stop if inadequate.
      const words = (text.trim().match(/\S+/g) || []).length
      if (words < 20) { $('#adAIMsg').textContent = t('adAIThin'); btn.disabled = false; lab.textContent = label; return }
      const res = await aiSuggest(text, d)
      const names = []
      for (const [id, v] of Object.entries(res.fields || {})) if (setField(id, v, 'ai')) names.push(id)
      aiVocab = (res.vocabulary || []).map(w => (typeof w === 'string' ? w : w.word))
      aiDismissed.clear()
      // Attribute the draft to the AI model in the reviewer field so it's clear
      // a human still needs to sign off (never an invented person's name).
      setField('adRevers', t('adAIBy'), 'ai')
      aiUsed = { used: true, mode: res.mode, fieldsSuggested: names, vocabularySuggested: aiVocab.length }
      $('#adAIMsg').textContent = names.length || aiVocab.length ? t('adAIDone', names.length) : t('adAINone')
    } catch (err) { $('#adAIMsg').textContent = String(err.message || err) }
    btn.disabled = false; lab.textContent = label; render()
  }
  // the AI button sits under the text box of whichever pane is open, and is hidden for link and bulk uploads
  function placeAI() {
    const wrap = $('#adAIWrap'), m = method()
    const slot = m === 'file' ? $('#adAISlotFile') : $('#adAISlot')
    if (slot && wrap.parentElement !== slot) slot.appendChild(wrap)
    wrap.hidden = !(m === 'paste' || m === 'file')
  }
  async function renderFeedback() {
    const box = $('#adFb'); if (!box) return
    const r = await loadRatings()
    $('#adFbClear').hidden = !r.length
    if (!r.length) { box.innerHTML = `<p class="ad-help">${t('adFbNone')}</p>`; return }
    const h = Math.round(100 * r.filter(x => x.helpful).length / r.length), a = Math.round(100 * r.filter(x => x.audioGood).length / r.length)
    box.innerHTML = `<p><strong>${t('adFbStats', r.length, h, a)}</strong></p><ul class="ad-fblist">${r.slice(-5).reverse().map(x => `<li><span class="ad-chip">${esc(x.passage)}</span> ${x.helpful ? '✓' : '✗'} content · ${x.audioGood ? '✓' : '✗'} voice${x.voice ? ' (' + esc(x.voice) + ')' : ''}${x.comment ? ` · “${esc(x.comment)}”` : ''}</li>`).join('')}</ul>
      <details class="ad-pay"><summary>JSON</summary><pre>${esc(JSON.stringify(r[r.length - 1], null, 2))}</pre></details>`
  }
  function render() { renderSummary(); renderQueue(); renderDetect(); renderFeedback() }

  // Queue rows advance only on real API progress now (see submit()). While a
  // passage is being generated we sweep the running stages up to the last one
  // for a live progress bar, but the final stage and the done/error state come
  // from the API's actual answer -- nothing is simulated to "succeed".
  setInterval(() => {
    let changed = false
    for (const e of queue) {
      if (e.state !== 'running' || !e.api) continue
      if (e.at >= e.stages.length - 1) continue // hold at the last stage until the API answers
      e.at += 1; changed = true
    }
    if (changed) { save(); renderQueue() }
  }, STAGE_MS)

  // Pasted text, or text read from a single file, can go to POST /api/v1/text-to-speech; the other methods have no API yet.
  const apiText = () => (method() === 'paste' || (method() === 'file' && files.length <= 1) ? sourceText().trim() : '')

  // Record the review state for a freshly generated passage: "review" when a
  // reviewer must sign off, "published" when the admin chose auto-publish.
  async function publishReview(e) {
    if (!e.pid) return
    const state = e.review === 'required' ? 'review' : 'published'
    await postReview({ pid: e.pid, state, by: val('adRevers') || undefined, notes: val('adNotes') || undefined })
  }

  // A stable, title-derived queue id so submitting the SAME passage twice
  // resolves to the same product id (<base>-en/-es) and the API rejects the
  // duplicate (409) instead of creating a new random-id record each time.
  function slugId(title) {
    const slug = (title || 'passage').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'passage'
    return slug
  }

  async function submit() {
    if (missing().length) return
    const p = payload()
    const text = apiText()
    // Everything runs through the cloud pipeline now. The paste and single-file
    // methods have the passage text to send; ReadWorks-id and bulk uploads have
    // no server-side fetch/CSV path, so they are refused rather than faked.
    if (!text) { $('#adMsg').textContent = t('adNoApiMethod'); return }
    if (!window.SA_API_URL) { $('#adMsg').textContent = t('adNoApi'); return }
    if (text.length > API_MAX_CHARS) { $('#adMsg').textContent = t('adTooLong', API_MAX_CHARS); return }
    const n = Math.max(1, itemCount())
    const title = p.passage.title || (p.input.readworksId ? 'ReadWorks ' + p.input.readworksId.slice(0, 8) : p.input.bulkFile || 'Untitled')
    const entry = {
      id: slugId(title), title: n > 1 && method() !== 'paste' ? `${title} (+${n - 1})` : title,
      src: p.passage.language === 'es-US' ? 'es' : 'en', both: !!p.pipeline.otherLanguage,
      band: p.passage.gradeBand ? BANDS.find(b => b[0] === p.passage.gradeBand)[1] : '—',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      stages: stagesFor(p), at: 0, state: 'running', review: p.review.mode, vis: p.review.afterApproval,
      api: true,
    }
    queue.unshift(entry)
    save(); $('#adMsg').textContent = ''; render()
    $('#adQH').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })

    // Voices come from etl/voices.json on the server; "audio" on means every configured voice, as the request shows.
    // The pipeline runs synchronously, so the 201 response is the real result -- the queue reflects it, nothing is simulated.
    // Both languages share a base id (<base>-en / <base>-es) so the player's
    // language toggle and GET ?lang= resolve each one's sibling.
    const srcLang = p.passage.language || 'en-US'
    const base = 'p-' + entry.id
    const res = await createProduct({ text, id: `${base}-${srcLang.slice(0, 2)}`, title: title.slice(0, 200), languageCode: srcLang, allVoices: on('adAud') })
    const e = queue.find(x => x.id === entry.id)
    if (!e) return // removed while it was running
    e.api = false
    // The English passage is "ready" if just created OR it already exists (409
    // on the stable id) — in both cases we have a valid English id to build on.
    const enId = `${base}-${srcLang.slice(0, 2)}`
    const already = res && !res.ok && /already exists/i.test(res.error || '')
    if ((res && res.ok) || already) {
      e.pid = res && res.ok ? res.record.id : enId
      e.at = e.stages.length
      e.state = e.review === 'required' ? 'review' : 'done'
      if (already) e.error = t('adDupe')
      await publishReview(e)
      // Vocabulary cards and Word Stops (real Bedrock drafts) when requested.
      // Cards are saved against the passage id so the player underlines them.
      let srcCards = []
      if (on('adCards') || on('adStops')) { e.gen = 'pending'; save(); renderQueue(); srcCards = await makeCardsAndStops(e, text, srcLang, enId) }
      // Other language: translate and generate the sibling (en <-> es) through the same pipeline.
      if (on('adTrans')) { e.other = 'pending'; save(); renderQueue(); await makeOtherLanguage(e, text, srcLang, base, srcCards) }
    } else { e.state = 'error'; e.error = (res && res.error) || 'Request failed' }
    save(); renderQueue()
  }

  // Draft vocabulary cards and/or Word Stops with Bedrock. Word Stops are
  // anchored on the card words and server-side pass the four publish checks.
  // Generate cards/stops, persist the cards against the passage id (pcards) so
  // the player underlines them, and return the cards for the sibling to localize.
  async function makeCardsAndStops(entry, text, srcLang, pid) {
    const lang = srcLang.startsWith('es') ? 'es' : 'en'
    let cards = []
    if (on('adCards')) { const r = await genCards(text, lang); cards = (r && r.cards) || [] }
    let stops = []
    if (on('adStops')) { const r = await genStops(text, cards.map(c => c.word), lang); stops = (r && r.stops) || [] }
    if (pid && cards.length) { try { await putPassageCards(pid, cards) } catch { /* best effort */ } }
    entry.cards = cards.length; entry.stops = stops.length; entry.gen = 'done'
    return cards
  }

  // Translate the passage into the other language (en <-> es) and generate that
  // sibling through the same pipeline (Amazon Translate + Polly voices for that
  // language), with its own cards and Word Stops. Best-effort: a failure is
  // noted on the row but does not fail the source passage.
  async function makeOtherLanguage(entry, srcText, srcLang, base, srcCards) {
    const src = srcLang.slice(0, 2), dst = src === 'es' ? 'en' : 'es'
    const tr = await translate(srcText, src, dst)
    if (!tr || !tr.text) { entry.other = 'error'; return }
    const title = await translate(entry.title, src, dst)
    const id = `${base}-${dst}`
    const dstLang = dst === 'es' ? 'es-US' : 'en-US'
    const res = await createProduct({ text: tr.text, id, title: ((title && title.text) || entry.title).slice(0, 200), languageCode: dstLang, allVoices: on('adAud') })
    entry.other = res && res.ok ? 'done' : (res && /already exists/i.test(res.error || '') ? 'done' : 'error')
    if (entry.other !== 'done') return
    await postReview({ pid: id, state: 'review' })  // AI translation always goes to human review
    // Localize the SOURCE cards to the translated passage's surface forms so the
    // same vocabulary underlines in the sibling language. Falls back to fresh
    // generation if we have no source cards.
    let sibCards = []
    if ((srcCards || []).length) {
      const r = await localizeCards(tr.text, srcCards, dst)
      sibCards = (r && r.cards) || []
      if (sibCards.length) { try { await putPassageCards(id, sibCards) } catch { /* best effort */ } }
    } else if (on('adCards') || on('adStops')) {
      await makeCardsAndStops(entry, tr.text, dstLang, id)
    }
  }

  // ---- events ----
  root.addEventListener('input', render)
  root.addEventListener('change', e => {
    if (e.target.name === 'adMethod') $$('.ad-pane').forEach(p => { p.hidden = p.dataset.pane !== method() })
    if (e.target.id === 'adRWUrl') $('#adRWMsg').textContent = !val('adRWUrl') ? '' : rwId() ? t('adRWOk', rwId()) : t('adRWBad')
    render()
  })
  root.addEventListener('input', e => { if (e.target.id === 'adRWUrl') $('#adRWMsg').textContent = !val('adRWUrl') ? '' : rwId() ? t('adRWOk', rwId()) : t('adRWBad') })

  async function takeFiles(list) {
    files = [...list]; fileTexts = []; jsonMeta = null
    const li = $('#adFileList'); li.innerHTML = ''
    for (const f of files) {
      const readable = /\.(txt|md|html?|json)$/i.test(f.name)
      let note = t('adFilePipe')
      if (readable) { try { const txt = await f.text(); let body = txt
        if (/\.json$/i.test(f.name)) { try { const o = JSON.parse(txt); const plain = o.text || (o.content && o.content.replace(/<[^>]+>/g, ' ')); if (plain) { body = plain.trim(); jsonMeta = { title: o.title, author: (o.a || [])[0], uuid: o.uuid, lexile: o.l && o.l[0] ? o.l[0] + 'L' : '' } } } catch { /* not a passage record */ } }
        fileTexts.push(body); note = t('adFileRead') } catch { /* leave as pipeline */ } }
      li.insertAdjacentHTML('beforeend', `<li><strong>${esc(f.name)}</strong> <span class="ad-help">${sizeLabel(f.size)} · ${note}</span></li>`)
    }
    if (files.length === 1 && fileTexts.length === 1) $('#adFileText').value = fileTexts[0]
    runDetect()
  }
  $('#adFiles').addEventListener('change', e => takeFiles(e.target.files))
  const drop = $('#adDrop')
  ;['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over') }))
  ;['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over') }))
  drop.addEventListener('drop', e => takeFiles(e.dataTransfer.files))

  $('#adBulk').addEventListener('change', async e => {
    const f = e.target.files[0]; bulkRows = null; $('#adBulkMsg').textContent = ''
    if (f && /\.csv$/i.test(f.name)) {
      try { const rows = (await f.text()).split(/\r?\n/).filter(l => l.trim()).length - 1; bulkRows = Math.max(rows, 0); $('#adBulkMsg').textContent = t('adBulkRows', bulkRows) } catch { /* ignore */ }
    }
    render()
  })
  $('#adTemplate').addEventListener('click', () => {
    const csv = 'title,author,language,gradeBand,grade,lexile,genre,topic,readworksId,pairedPassageId,rights,textFile\n'
      + '"Example title","Example author",en-US,35,4,600L,nonfiction,"Science",,,readworks,example.txt\n'
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'sound_along_template.csv'; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  })
  $('#adSubmit').addEventListener('click', submit)
  $('#adDry').addEventListener('click', () => { $('#adMsg').textContent = t('adDryDone'); render() })
  $('#adCopy').addEventListener('click', async () => {
    const b = $('#adCopy')
    try { await navigator.clipboard.writeText($('#adPayload').textContent); b.textContent = t('adCopied') } catch { /* selection fallback is manual */ }
    setTimeout(() => { b.textContent = t('adCopy') }, 1500)
  })
  $('#adClear').addEventListener('click', () => { queue = []; save(); render() })
  $('#adQueue').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]'); if (!b) return
    const i = queue.findIndex(x => x.id === b.dataset.id); if (i < 0) return
    if (b.dataset.act === 'remove') {
      const entry = queue[i]
      // Delete everything generated for this passage (both -en/-es siblings:
      // product records, audio, vocab cards, review state) when it has a pid.
      if (entry.pid) {
        if (!confirm(t('adRemoveConfirm'))) return
        b.disabled = true; entry.error = t('adRemoving'); renderQueue()
        try { await deletePassage(entry.pid) } catch { /* leave the row so the admin can retry */
          entry.error = t('adRemoveFail'); renderQueue(); return }
      }
      queue.splice(i, 1); save(); renderQueue(); return
    }
    // Approve: record the real publish decision, then mark the row done.
    const entry = queue[i]
    if (entry.pid) await postReview({ pid: entry.pid, state: 'published', by: val('adRevers') || undefined })
    entry.state = 'done'; entry.vis = 'published'
    save(); renderQueue()
  })
  // sub-options follow their parent toggle
  const syncParents = () => {
    $$('#adAudEn,#adAudEs').forEach(i => { i.disabled = !on('adAud') })
    $$('input[name="adBands"]').forEach(i => { i.disabled = !on('adStops') })
    $('#adStopAud').disabled = !on('adStops')
    $$('#adQsAud,#adQsEv').forEach(i => { i.disabled = val('adQsSrc') === 'none' })
  }
  root.addEventListener('change', syncParents); syncParents()

  root.addEventListener('input', e => {
    const id = e.target.id
    if (FILL.includes(id)) { touched.add(id); auto.delete(id); badge(id, null) }
    if (id === 'adText' || id === 'adFileText' || id === 'adRWUrl') { clearTimeout(detTimer); detTimer = setTimeout(runDetect, 400) }
  })
  root.addEventListener('change', e => {
    if (e.target.id === 'adTrans') touched.add('adTrans')
    if (e.target.name === 'adMethod') { placeAI(); runDetect() }
  })
  root.addEventListener('click', e => {
    if (e.target.id === 'adUndo') { undoFill(); return }
    // Per-word Keep/Remove toggle on AI vocab chips.
    const chip = e.target.closest('.ad-vchip')
    if (chip) {
      const w = chip.dataset.vocab.toLowerCase()
      if (aiDismissed.has(w)) aiDismissed.delete(w); else aiDismissed.add(w)
      renderDetect()
    }
  })
  $('#adAI').addEventListener('click', openAI)
  $('#adFbClear').addEventListener('click', () => clearRatings())
  window.addEventListener('sa-rating', renderFeedback)
  placeAI()

  render()
  return { render }
}
