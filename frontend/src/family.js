// Teacher and parent views. Teachers see a class, click into a student, and get class-level and student-level suggestions.
// Parents see their children, what was read, the words covered, and words to go over again.
import { art } from './art.js'
import { byPid, byBand, gradeText, modeFor, titleOf, vocabWord, wordLabel } from './content.js'
import { CLASSES, STUDENTS, PARENTS, TEACHERS, student, klass, teacherOf, firstName, studentsIn, parentsOf, bandOf, summary, classSummary, studentTips, classTips, assignmentsFor, assign, unassign, loadAssign, recordPractice, fmtMin } from './people.js'

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const DAY = 86400000

export function createFamily({ t, getLang, getProfile, onRead }) {
  const root = document.getElementById('family')
  const st = { tab: 'teacher', cls: 'c2', fam: 'p-chen', stu: null, sub: 'log', sort: 'name', dir: 1, wf: 'all', open: null }
  try { const s = localStorage.getItem('ws-fam'); if (s === 'parent') st.tab = 'parent' } catch { /* storage can be blocked */ }
  const es = () => getLang() === 'es'
  const loc = () => (es() ? 'es-US' : 'en-US')
  const dt = iso => new Date(iso).toLocaleString(loc(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const dd = iso => new Date(iso).toLocaleDateString(loc(), { month: 'short', day: 'numeric' })
  const ago = days => (days == null ? '—' : days <= 0 ? t('fToday') : days === 1 ? t('fYesterday') : t('fDaysAgo', days))
  const dueText = iso => { const d = Math.ceil((new Date(iso) - Date.now()) / DAY); return d <= 0 ? t('fDueToday') : d === 1 ? t('fDueTomorrow') : t('fDueIn', d) }
  const stars = n => '<span class="fm-st" role="img" aria-label="' + t('fStarsN', n) + '">' + '★'.repeat(n) + '☆'.repeat(3 - n) + '</span>'
  const tagName = k => t('tag_' + k)
  const gradeLbl = e => gradeText(e, es())
  const meter = n => '<span class="fm-meter s' + n + '" role="img" aria-label="' + t('fStrength', n) + '"><i></i><i></i><i></i></span>'

  // ---- profile helpers ----
  const prof = () => getProfile()
  const myClasses = () => { const p = prof(); return p.role === 'teacher' ? [klass(p.te.cls)] : CLASSES }
  const myFamilies = () => { const p = prof(); return p.role === 'parent' ? [p.pa] : PARENTS }

  // ---- suggestion text ----
  const title = e => titleOf(e, es())
  const word = w => wordLabel(w, es())
  // Tip args: word/name lists, passage entries (shown by title) or plain values.
  const list = a => (Array.isArray(a) ? a.map(word).join(', ') : a && a.pid ? title(a) : a)
  function tipText(role, tip, stu) {
    const n = stu ? firstName(stu) : ''
    return t((role === 'parent' ? 'pt_' : 'tt_') + tip.k, n, ...tip.a.map(list))
  }
  function tipHtml(role, tip, stu, scope) {
    const a = tip.act
    let btn = ''
    if (a && a.type === 'practice') btn = '<button type="button" class="chipbtn" data-practice="' + esc(a.words.join('|')) + '" data-stu="' + (stu ? stu.id : '') + '">' + esc(t('fPractice')) + '</button>'
    if (a && a.type === 'assign' && a.pid && byPid(a.pid)) btn = '<button type="button" class="chipbtn" data-assign="' + a.pid + '" data-stu="' + (stu ? stu.id : '') + '">' + esc(t('fAssignThis', title(byPid(a.pid)))) + '</button>'
    return '<li class="fm-tip"><span class="fm-bulb" aria-hidden="true">💡</span><div><p>' + esc(tipText(role, tip, stu)) + '</p>' + btn + '</div></li>'
  }

  // ---- shared pieces ----
  const stat = (v, l) => '<div class="fm-stat"><b>' + v + '</b><span>' + esc(l) + '</span></div>'
  const thumb = e => '<span class="fm-thumb" aria-hidden="true">' + art(e.pid) + '<img src="img/' + e.pid + '.jpg" alt="" loading="lazy" onerror="this.remove()"></span>'
  function sessionRow(s, role) {
    const e = byPid(s.pid); if (!e) return ''
    const open = st.open === s.id
    const ratio = s.minutes / e.minutes
    const pace = ratio < 0.6 ? 'fast' : ratio > 1.6 ? 'slow' : 'ok'
    const words = s.words.map(w => '<button type="button" class="fm-wchip" data-word="' + esc(w) + '" data-stu="' + s.student + '">' + esc(word(w)) + '</button>').join('')
    return '<li class="fm-sess' + (open ? ' open' : '') + '"><button type="button" class="fm-srow" data-sess="' + s.id + '" aria-expanded="' + open + '">'
      + thumb(e) + '<span class="fm-sinfo"><b>' + esc(title(e)) + '</b><span class="fm-sub">' + esc(gradeLbl(e)) + ' · ' + esc(dt(s.at)) + '</span></span>'
      + '<span class="fm-scell"><b>' + esc(fmtMin(s.minutes)) + '</b><span class="fm-sub pace-' + pace + '">' + esc(t('fPace_' + pace, e.minutes)) + '</span></span>'
      + '<span class="fm-scell"><b>' + (s.q == null ? '—' : s.q + '%') + '</b><span class="fm-sub">' + esc(t('fQuestions')) + '</span></span>'
      + '<span class="fm-scell">' + stars(s.stars) + '<span class="fm-sub">' + s.words.length + ' ' + esc(t('fWordsN')) + '</span></span>'
      + '<span class="fm-chev" aria-hidden="true">▾</span></button>'
      + (open ? '<div class="fm-sdet"><p class="fm-sub">' + esc(t(s.source === 'assigned' ? 'fSrcAssigned' : 'fSrcIndep')) + '</p>'
        + '<h4>' + esc(t('fWordsCovered')) + '</h4>' + (words ? '<div class="fm-chips">' + words + '</div>' : '<p class="fm-note">' + esc(t('fNoWordsSession')) + '</p>')
        + '<div class="fm-btns"><button type="button" class="chipbtn" data-read="' + e.pid + '">' + esc(t(role === 'parent' ? 'fReadAgain' : 'fOpenStudent')) + '</button></div></div>' : '') + '</li>'
  }

  function wordsPane(stu, role) {
    const m = summary(stu.id)
    const f = st.wf
    const ws = m.words.filter(w => f === 'all' || (f === 'due' && w.due) || (f === 'strong' && w.strength >= 3))
    const chip = (k, n) => '<button type="button" class="fm-fchip" data-wf="' + k + '" aria-pressed="' + (f === k) + '">' + esc(t('fWf_' + k)) + ' (' + n + ')</button>'
    return '<div class="fm-filters">' + chip('all', m.words.length) + chip('due', m.due.length) + chip('strong', m.words.filter(w => w.strength >= 3).length) + '</div>'
      + (m.due.length ? '<div class="fm-btns"><button type="button" class="tbtn" data-practice="' + esc(m.due.slice(0, 8).map(w => w.w).join('|')) + '" data-stu="' + stu.id + '">' + esc(t('fPracticeN', Math.min(8, m.due.length))) + '</button></div>' : '')
      + (ws.length ? '<ul class="fm-wgrid">' + ws.map(w => '<li><button type="button" class="fm-wtile' + (w.due ? ' due' : '') + '" data-word="' + esc(w.w) + '" data-stu="' + stu.id + '"><b>' + esc(word(w.w)) + '</b>' + meter(w.strength) + '<span class="fm-sub">' + esc(t('fSeen', w.count)) + ' · ' + esc(dd(w.last)) + '</span></button></li>').join('') + '</ul>' : '<p class="fm-note">' + esc(t('fNoWords')) + '</p>')
  }

  function assignedPane(stu, role) {
    const as = assignmentsFor(stu.id)
    const me = prof()
    const row = a => { const e = byPid(a.pid); if (!e) return ''
      return '<li class="fm-asg' + (a.done ? ' done' : '') + '">' + thumb(e) + '<span class="fm-sinfo"><b>' + esc(title(e)) + '</b><span class="fm-sub">' + esc(t('fBy', a.byName)) + ' · ' + esc(a.done ? t('fDone') : dueText(a.due)) + '</span></span>'
        + (a.done ? '<span class="fm-pill ok">✓ ' + esc(t('fDone')) + '</span>' : '<span class="fm-pill">' + esc(t('fToDo')) + '</span>')
        + (!a.seed && !a.done && (a.by === me.id) ? '<button type="button" class="chipbtn" data-unassign="' + a.id + '">' + esc(t('fRemove')) + '</button>' : '') + '</li>' }
    return '<div class="fm-btns"><button type="button" class="tbtn" data-assign="" data-stu="' + stu.id + '">' + esc(t(role === 'parent' ? 'fSendReading' : 'fAssign')) + '</button></div>'
      + (as.length ? '<ul class="fm-alist">' + as.map(row).join('') + '</ul>' : '<p class="fm-note">' + esc(t('fNoAssigned')) + '</p>')
  }

  function studentView(stu, role) {
    const m = summary(stu.id), c = klass(stu.cls), te = teacherOf(stu.cls), pa = parentsOf(stu.id)
    const subs = ['log', 'words', 'assigned', 'tips']
    const body = st.sub === 'log' ? (m.sessions.length ? '<ul class="fm-slist">' + m.sessions.map(s => sessionRow(s, role)).join('') + '</ul>' : '<p class="fm-note">' + esc(t('fNoSessions')) + '</p>')
      : st.sub === 'words' ? wordsPane(stu, role)
      : st.sub === 'assigned' ? assignedPane(stu, role)
      : '<ul class="fm-tips">' + studentTips(stu.id, role).map(x => tipHtml(role, x, stu)).join('') + '</ul>'
    return (role === 'teacher' ? '<button type="button" class="chipbtn fm-back" data-back="1">← ' + esc(t('fBackClass')) + '</button>' : '')
      + '<section class="fm-card fm-prof"><div><h2>' + esc(stu.name) + '</h2><p class="fm-sub">' + esc(t('fClassLine', c.name, c.grade)) + ' · ' + esc(te.name)
      + (role === 'teacher' && pa.length ? ' · ' + esc(t('fParentLine', pa.map(p => p.name).join(', '))) : '') + '</p></div></section>'
      + '<div class="fm-stats">' + stat(m.passages, t('fPassagesRead')) + stat(fmtMin(m.minutes / Math.max(1, m.sessions.length)), t('fAvgTime')) + stat(m.q == null ? '—' : m.q + '%', t('fQuestions')) + stat(m.wordsCovered, t('fWordsCovered')) + stat(ago(m.lastDays), t('fLastActive')) + '</div>'
      + '<div class="fm-subtabs" role="tablist">' + subs.map(k => '<button type="button" role="tab" data-sub="' + k + '" aria-selected="' + (st.sub === k) + '">' + esc(t('fSub_' + k)) + (k === 'words' && m.due.length ? ' <span class="fm-badge">' + m.due.length + '</span>' : '') + (k === 'assigned' && m.open.length ? ' <span class="fm-badge">' + m.open.length + '</span>' : '') + '</button>').join('') + '</div>'
      + '<section class="fm-card" role="tabpanel">' + body + '</section>'
  }

  // ---- teacher ----
  function flags(m) {
    const f = []
    if (m.lastDays == null || m.lastDays >= 10) f.push(['warn', t('fFlagQuiet')])
    if (m.ratio != null && m.ratio < 0.65 && m.q != null && m.q < 70) f.push(['warn', t('fFlagFast')])
    if (m.ratio != null && m.ratio > 1.5 && m.q != null && m.q < 65) f.push(['warn', t('fFlagSlow')])
    if (m.q != null && m.q >= 85 && m.sessions.length >= 4) f.push(['ok', t('fFlagStrong')])
    return f.map(([k, x]) => '<span class="fm-flag ' + k + '">' + esc(x) + '</span>').join('')
  }
  function classView() {
    const cls = klass(st.cls), c = classSummary(cls.id), te = teacherOf(cls.id)
    const sorters = {
      name: x => x.s.name, passages: x => x.m.passages, last: x => (x.m.lastDays == null ? 999 : x.m.lastDays), time: x => x.m.ratio || 0, q: x => (x.m.q == null ? -1 : x.m.q), words: x => x.m.wordsCovered,
    }
    const rows = [...c.sums].sort((a, b) => { const A = sorters[st.sort](a), B = sorters[st.sort](b); return (A < B ? -1 : A > B ? 1 : 0) * st.dir })
    const th = (k, label) => '<th scope="col" aria-sort="' + (st.sort === k ? (st.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="fm-sort" data-sort="' + k + '">' + esc(label) + (st.sort === k ? (st.dir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>'
    const tips = classTips(cls.id)
    return '<section class="fm-card fm-prof"><div><h2>' + esc(t('fClassTitle', cls.name, cls.grade)) + '</h2><p class="fm-sub">' + esc(te.name) + ' · ' + esc(t('fStudentsN', c.total)) + '</p></div>'
      + '<div class="fm-btns"><button type="button" class="tbtn" data-assign="" data-cls="' + cls.id + '">' + esc(t('fAssignClass')) + '</button></div></section>'
      + '<div class="fm-stats">' + stat(c.active + '/' + c.total, t('fActiveWeek')) + stat(c.passages, t('fPassagesRead')) + stat(c.minutes, t('fMinutes')) + stat(c.q == null ? '—' : c.q + '%', t('fQuestions')) + stat(c.openAssign, t('fOpenAssign')) + '</div>'
      + '<section class="fm-card" id="fmClassTips"><h3>' + esc(t('fClassTips')) + '</h3><ul class="fm-tips">' + tips.map(x => {
        let btn = ''
        if (x.k === 'cwords') btn = '<button type="button" class="chipbtn" data-practice="' + esc(c.hardWords.map(w => w.w).join('|')) + '" data-stu="">' + esc(t('fWarmup')) + '</button>'
        return '<li class="fm-tip"><span class="fm-bulb" aria-hidden="true">💡</span><div><p>' + esc(t('tc_' + x.k, ...x.a.map(list))) + '</p>' + btn + '</div></li>' }).join('') + '</ul></section>'
      + '<section class="fm-card" id="fmStudents"><h3>' + esc(t('fStudents')) + '</h3><p class="fm-sub">' + esc(t('fClickStudent')) + '</p><div class="fm-scroll"><table class="fm-table fm-click"><thead><tr>'
      + th('name', t('fName')) + th('passages', t('fPassagesRead')) + th('last', t('fLastActive')) + th('time', t('fTimeVsExpected')) + th('q', t('fQuestions')) + th('words', t('fWordsCovered')) + '<th scope="col">' + esc(t('fFlags')) + '</th></tr></thead><tbody>'
      + rows.map(({ s, m }) => '<tr tabindex="0" data-stu="' + s.id + '"><th scope="row"><button type="button" class="fm-name" data-open-stu="' + s.id + '">' + esc(s.name) + '</button></th><td>' + m.passages + '</td><td>' + esc(ago(m.lastDays)) + '</td><td>' + (m.ratio == null ? '—' : Math.round(m.ratio * 100) + '%') + '</td><td>' + (m.q == null ? '—' : m.q + '%') + '</td><td>' + m.wordsCovered + '</td><td>' + flags(m) + '</td></tr>').join('')
      + '</tbody></table></div></section>'
      + '<section class="fm-card"><h3>' + esc(t('fClassWords')) + '</h3><p class="fm-sub">' + esc(t('fClassWordsSub')) + '</p>'
      + (c.hardWords.length ? '<div class="fm-chips">' + c.hardWords.map(w => '<button type="button" class="fm-wchip hard" data-word="' + esc(w.w) + '" data-stu="">' + esc(word(w.w)) + ' <b>' + w.n + '</b></button>').join('') + '</div><div class="fm-btns"><button type="button" class="chipbtn" data-practice="' + esc(c.hardWords.map(w => w.w).join('|')) + '" data-stu="">' + esc(t('fWarmup')) + '</button></div>' : '<p class="fm-note">' + esc(t('fNoWords')) + '</p>') + '</section>'
      + '<section class="fm-card"><h3>' + esc(t('fPassageTable')) + '</h3><div class="fm-scroll"><table class="fm-table"><thead><tr><th scope="col">' + esc(t('fPassage')) + '</th><th scope="col">' + esc(t('fReads')) + '</th><th scope="col">' + esc(t('fAvgTime')) + '</th><th scope="col">' + esc(t('fQuestions')) + '</th><th scope="col"><span class="fm-sr">' + esc(t('fAssign')) + '</span></th></tr></thead><tbody>'
      + c.passageRows.map(p => { const e = byPid(p.pid); if (!e) return ''; return '<tr><th scope="row">' + esc(title(e)) + '<span class="fm-sub"> · ' + esc(gradeLbl(e)) + '</span></th><td>' + p.reads + '</td><td>' + esc(fmtMin(p.minutes)) + '</td><td>' + (p.q == null ? '—' : p.q + '%') + '</td><td><button type="button" class="chipbtn" data-assign="' + p.pid + '" data-cls="' + cls.id + '">' + esc(t('fAssignShort')) + '</button></td></tr>' }).join('') + '</tbody></table></div></section>'
  }
  function teacherBody() {
    const cs = myClasses()
    const pick = cs.length > 1 ? '<div class="fm-pick" role="tablist" aria-label="' + esc(t('fPickClass')) + '">' + cs.map(c => '<button type="button" role="tab" data-cls-pick="' + c.id + '" aria-selected="' + (st.cls === c.id) + '">' + esc(t('fClassShort', c.grade)) + '</button>').join('') + '</div>' : ''
    if (!cs.some(c => c.id === st.cls)) st.cls = cs[0].id
    return pick + (st.stu && student(st.stu) && student(st.stu).cls === st.cls ? studentView(student(st.stu), 'teacher') : classView())
  }

  // ---- parent ----
  function parentBody() {
    const fs = myFamilies()
    if (!fs.some(f => f.id === st.fam)) st.fam = fs[0].id
    const fam = fs.find(f => f.id === st.fam)
    if (!st.stu || !fam.kids.includes(st.stu)) st.stu = fam.kids[0]
    const kids = fam.kids.map(student)
    const kid = student(st.stu), m = summary(kid.id)
    const famPick = fs.length > 1 ? '<label class="fm-who">' + esc(t('fFamily')) + ' <select id="fmFam">' + fs.map(f => '<option value="' + f.id + '"' + (f.id === st.fam ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('') + '</select></label>' : ''
    const kidPick = kids.length > 1 ? '<div class="fm-pick" role="tablist" aria-label="' + esc(t('fPickChild')) + '">' + kids.map(k => '<button type="button" role="tab" data-kid="' + k.id + '" aria-selected="' + (st.stu === k.id) + '">' + esc(firstName(k)) + '</button>').join('') + '</div>' : ''
    const next = m.open[0]
    const nextCard = next ? (() => { const e = byPid(next.pid); return '<section class="fm-card fm-nextcard">' + thumb(e) + '<div class="fm-sinfo"><span class="fm-sub">' + esc(t('fNextUp', firstName(kid))) + '</span><b>' + esc(title(e)) + '</b><span class="fm-sub">' + esc(t('fBy', next.byName)) + ' · ' + esc(dueText(next.due)) + '</span></div><button type="button" class="tbtn" data-read="' + e.pid + '" data-asfor="' + kid.id + '">' + esc(t('fStartReading')) + '</button></section>' })() : ''
    return '<div class="fm-bar">' + famPick + '</div><p class="fm-sub fm-fam">' + esc(t('fFamilyLine', fam.name)) + '</p>' + kidPick + nextCard + studentView(kid, 'parent')
      + '<section class="fm-card"><h3>' + esc(t('pVoice')) + '</h3><p>' + esc(t('pVoiceB')) + '</p><h3>' + esc(t('pPriv')) + '</h3><p>' + esc(t('pPrivB')) + '</p></section>'
  }

  // ---- dialogs ----
  const dlg = document.createElement('dialog'); dlg.className = 'sa-dlg'; dlg.id = 'fmDlg'; document.body.appendChild(dlg)
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close() })
  const xbtn = () => '<button type="button" class="dlg-x" aria-label="' + esc(t('infoClose')) + '" data-close="1">×</button>'
  function wordDlg(w, stuId) {
    const info = vocabWord(w, es())
    const m = stuId ? summary(stuId).words.find(x => x.w.toLowerCase() === w.toLowerCase()) : null
    dlg.innerHTML = xbtn() + '<h2>' + esc(info ? info.w : w) + '</h2>' + (info ? '<p>' + esc(info.def) + '</p>' + (info.ex ? '<p class="fm-ex">“' + esc(info.ex) + '”</p>' : '') + '<p class="fm-sub">' + esc(t('fFromPassage', info.title)) + '</p>' : '')
      + (m ? '<p>' + meter(m.strength) + ' <span class="fm-sub">' + esc(t('fSeen', m.count)) + ' · ' + esc(t('fLastSeen', dd(m.last))) + '</span></p>' : '')
    dlg.showModal()
  }
  function practiceDlg(words, stuId) {
    const cards = words.map(w => vocabWord(w, es()) || { w, key: w, def: '', ex: '', title: '' })
    let i = 0, knew = 0
    const draw = (shown) => {
      if (i >= cards.length) { dlg.innerHTML = xbtn() + '<h2>' + esc(t('fPracDone')) + '</h2><p>' + esc(stuId ? t('fPracResult', knew, cards.length) : t('fPracClass', cards.length)) + '</p><div class="dlg-actions"><button type="button" class="tbtn" data-close="1">' + esc(t('fClose')) + '</button></div>'; return }
      const c = cards[i]
      dlg.innerHTML = xbtn() + '<p class="fm-sub">' + esc(t('fPracCount', i + 1, cards.length)) + '</p><h2 class="fm-big">' + esc(c.w) + '</h2>'
        + (c.ex ? '<p class="fm-ex">“' + esc(c.ex) + '”</p>' : '') + (c.title ? '<p class="fm-sub">' + esc(t('fFromPassage', c.title)) + '</p>' : '')
        + (shown ? '<p class="fm-def">' + esc(c.def || t('fNoDef')) + '</p>' + (stuId ? '<div class="fm-btns"><button type="button" class="tbtn" data-knew="1">' + esc(t('fKnewIt')) + '</button><button type="button" class="chipbtn" data-knew="0">' + esc(t('fStillLearning')) + '</button></div>' : '<div class="fm-btns"><button type="button" class="tbtn" data-knew="x">' + esc(t('fNext')) + '</button></div>')
          : '<p class="fm-note">' + esc(t(stuId ? 'fPracAsk' : 'fPracAskClass')) + '</p><div class="fm-btns"><button type="button" class="tbtn" data-reveal="1">' + esc(t('fReveal')) + '</button></div>')
    }
    dlg.onclick = e => {
      if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return }
      if (e.target.closest('[data-reveal]')) { draw(true); return }
      const k = e.target.closest('[data-knew]')
      if (k) { if (stuId && k.dataset.knew !== 'x') { const ok = k.dataset.knew === '1'; if (ok) knew++; recordPractice(stuId, cards[i].key, ok) } i++; draw(false) }
    }
    draw(false); dlg.showModal()
  }
  function assignDlg(pid, stuId, clsId) {
    const p = prof(), role = p.role === 'parent' ? 'parent' : 'teacher'
    const target = clsId ? { cls: clsId } : { stu: stuId }
    const stuObj = target.stu ? student(target.stu) : null
    const cls = stuObj ? stuObj.cls : target.cls
    const band = klass(cls).band
    const options = [band, ...['k2', '35', '68', '912'].filter(b => b !== band)]
    const toOpts = target.cls ? '<option value="c:' + cls + '">' + esc(t('fWholeClass', klass(cls).name)) + '</option>' + studentsIn(cls).map(s => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join('') : '<option value="' + stuObj.id + '">' + esc(stuObj.name) + '</option>'
    const by = p.role === 'parent' ? { by: p.id, byName: p.name } : p.role === 'teacher' ? { by: p.id, byName: p.name } : { by: teacherOf(cls).id, byName: teacherOf(cls).name }
    dlg.onclick = e => {
      if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return }
      if (e.target.closest('#fmAsgGo')) {
        const sel = document.getElementById('fmAsgPid').value, to = document.getElementById('fmAsgTo').value, days = +document.getElementById('fmAsgDue').value
        assign({ pid: sel, to, ...by, due: new Date(Date.now() + days * DAY).toISOString() })
        dlg.innerHTML = xbtn() + '<h2>' + esc(t('fAsgSent')) + '</h2><p>' + esc(t('fAsgSentB', title(byPid(sel)))) + '</p><div class="dlg-actions"><button type="button" class="tbtn" data-close="1">OK</button></div>'
      }
    }
    dlg.innerHTML = xbtn() + '<h2>' + esc(t(role === 'parent' ? 'fSendReading' : 'fAssign')) + '</h2>'
      + '<label class="dlg-c" for="fmAsgPid">' + esc(t('fAsgPassage')) + '</label><select id="fmAsgPid">' + options.map(b => '<optgroup label="' + esc(t('fBand_' + b)) + '">' + byBand(b).map(e => '<option value="' + e.pid + '"' + (e.pid === pid ? ' selected' : '') + '>' + esc(title(e) + ' · ' + gradeLbl(e)) + '</option>').join('') + '</optgroup>').join('') + '</select>'
      + '<label class="dlg-c" for="fmAsgTo">' + esc(t('fAsgTo')) + '</label><select id="fmAsgTo">' + toOpts + '</select>'
      + '<label class="dlg-c" for="fmAsgDue">' + esc(t('fAsgDue')) + '</label><select id="fmAsgDue"><option value="1">' + esc(t('fDueTomorrow')) + '</option><option value="3">' + esc(t('fDueIn', 3)) + '</option><option value="7" selected>' + esc(t('fDueIn', 7)) + '</option></select>'
      + '<div class="dlg-actions"><button type="button" class="tbtn" id="fmAsgGo">' + esc(t(role === 'parent' ? 'fSendReading' : 'fAssign')) + '</button><button type="button" class="chipbtn" data-close="1">' + esc(t('rateCancel')) + '</button></div>'
    dlg.showModal()
  }

  // ---- render + events ----
  function render() {
    const p = prof()
    if (p.role === 'parent') st.tab = 'parent'; else if (p.role === 'teacher') st.tab = 'teacher'
    const lock = p.role === 'parent' || p.role === 'teacher'
    const chk = v => (st.tab === v ? 'checked' : '')
    root.innerHTML = '<h1>' + esc(t('famTitle')) + '</h1><p class="fm-lead">' + esc(lock ? t(p.role === 'teacher' ? 'fLeadT' : 'fLeadP') : t('famSub')) + '</p>'
      + (lock ? '' : '<div class="ad-seg fm-seg" role="radiogroup" aria-label="' + esc(t('famSegLbl')) + '"><label><input type="radio" name="fmv" value="teacher" ' + chk('teacher') + '><span>' + esc(t('famTeacher')) + '</span></label><label><input type="radio" name="fmv" value="parent" ' + chk('parent') + '><span>' + esc(t('famParent')) + '</span></label></div>')
      + '<div id="fmBody">' + (st.tab === 'teacher' ? teacherBody() : parentBody()) + '</div>'
  }
  const rerender = () => { const y = scrollY; render(); scrollTo(0, y) }

  root.addEventListener('change', e => {
    if (e.target.name === 'fmv') { st.tab = e.target.value; st.stu = null; st.sub = 'log'; try { localStorage.setItem('ws-fam', st.tab) } catch { /* ignore */ } render(); const r = root.querySelector('input[value="' + st.tab + '"]'); if (r) r.focus({ preventScroll: true }) }
    else if (e.target.id === 'fmFam') { st.fam = e.target.value; st.stu = null; st.sub = 'log'; rerender() }
  })
  root.addEventListener('click', e => {
    const q = s => e.target.closest(s)
    let x
    if ((x = q('[data-open-stu]'))) { st.stu = x.dataset.openStu; st.sub = 'log'; st.open = null; render(); scrollTo(0, 0) }
    else if (q('[data-back]')) { st.stu = null; render(); scrollTo(0, 0) }
    else if ((x = q('[data-cls-pick]'))) { st.cls = x.dataset.clsPick; st.stu = null; rerender() }
    else if ((x = q('[data-kid]'))) { st.stu = x.dataset.kid; st.sub = 'log'; st.open = null; rerender() }
    else if ((x = q('[data-sub]'))) { st.sub = x.dataset.sub; rerender() }
    else if ((x = q('[data-sort]'))) { const k = x.dataset.sort; if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = 1 } rerender() }
    else if ((x = q('[data-sess]'))) { st.open = st.open === x.dataset.sess ? null : x.dataset.sess; rerender() }
    else if ((x = q('[data-wf]'))) { st.wf = x.dataset.wf; rerender() }
    else if ((x = q('[data-word]'))) wordDlg(x.dataset.word, x.dataset.stu)
    else if ((x = q('[data-practice]'))) practiceDlg(x.dataset.practice.split('|'), x.dataset.stu)
    else if ((x = q('[data-assign]'))) assignDlg(x.dataset.assign, x.dataset.stu, x.dataset.cls)
    else if ((x = q('[data-unassign]'))) { unassign(x.dataset.unassign) }
    else if ((x = q('[data-read]'))) onRead(x.dataset.read, x.dataset.asfor)
    else if ((x = q('tr[data-stu]'))) { st.stu = x.dataset.stu; st.sub = 'log'; st.open = null; render(); scrollTo(0, 0) }
  })
  root.addEventListener('keydown', e => { const r = e.target.closest && e.target.closest('tr[data-stu]'); if (r && e.key === 'Enter' && e.target === r) { st.stu = r.dataset.stu; st.sub = 'log'; render(); scrollTo(0, 0) } })
  window.addEventListener('sa-people', () => { if (!root.hidden) rerender() })
  // Open straight to a person: role 'teacher' with a class, 'parent' with a family, optionally a student and tab.
  function show(o = {}) {
    if (o.tab) { st.tab = o.tab; try { localStorage.setItem('ws-fam', st.tab) } catch { /* ignore */ } }
    if (o.cls) st.cls = o.cls
    if (o.fam) st.fam = o.fam
    if (o.stu !== undefined) st.stu = o.stu
    if (o.sub) st.sub = o.sub
    render()
  }
  return { render, show }
}
