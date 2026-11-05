// Linked cast: teachers, classes, students and parents across all four grade bands, plus what each one has read.
// The same records feed the student view (Up next), the parent view and the teacher view.
//
// Roster, reading sessions, assignments and word practice are cloud-backed via the data API
// (src/data_api.js -> /api/v1/data). On startup we hydrate a synchronous in-memory cache so the
// existing render paths keep their synchronous accessors; writes go to the cloud and update the
// cache optimistically. The ROSTER_SEED / per-student sample history below are the local-dev
// fallback (no API configured) and the source the post-deploy seeding script loads into DynamoDB.
import { CATALOG, byPid, byBand, gradeNum, stepUp } from './content.js'
import {
  hasDataApi, getRoster, getSessions, getAssignments, getPractice,
  postSession, postAssignment, deleteAssignment, postPractice,
} from './data_api.js'

export const CLASSES_SEED = [
  { id: 'c2', name: 'Room 4', grade: 2, band: 'k2', teacher: 't-rivera' },
  { id: 'c4', name: 'Room 12', grade: 4, band: '35', teacher: 't-okafor' },
  { id: 'c7', name: 'Room 207', grade: 7, band: '68', teacher: 't-alvarez' },
  { id: 'c10', name: 'Room 310', grade: 10, band: '912', teacher: 't-bennett' },
]
export const TEACHERS_SEED = [
  { id: 't-rivera', name: 'Ms. Rivera', cls: 'c2' }, { id: 't-okafor', name: 'Mr. Okafor', cls: 'c4' },
  { id: 't-alvarez', name: 'Ms. Alvarez', cls: 'c7' }, { id: 't-bennett', name: 'Mr. Bennett', cls: 'c10' },
]
const S = (id, name, cls, arch) => ({ id: 's-' + id, name, cls, arch })
export const STUDENTS_SEED = [
  S('maya', 'Maya Chen', 'c2', 'steady'), S('noah', 'Noah Brooks', 'c2', 'skimmer'), S('ava', 'Ava Patel', 'c2', 'strong'), S('leo', 'Leo Garcia', 'c2', 'struggling'), S('zoe', 'Zoe Adams', 'c2', 'inactive'), S('eli', 'Eli Johnson', 'c2', 'steady'),
  S('sofia', 'Sofia Reyes', 'c4', 'strong'), S('jamal', 'Jamal Carter', 'c4', 'skimmer'), S('lily', 'Lily Nguyen', 'c4', 'steady'), S('owen', 'Owen Kim', 'c4', 'struggling'), S('grace', 'Grace Murphy', 'c4', 'steady'), S('marcus', 'Marcus Hill', 'c4', 'inactive'),
  S('daniel', 'Daniel Chen', 'c7', 'steady'), S('isabella', 'Isabella Rossi', 'c7', 'strong'), S('tyler', 'Tyler Moore', 'c7', 'skimmer'), S('amara', 'Amara Okoye', 'c7', 'steady'), S('caleb', 'Caleb Foster', 'c7', 'struggling'), S('nina', 'Nina Petrov', 'c7', 'inactive'),
  S('hannah', 'Hannah Lee', 'c10', 'strong'), S('diego', 'Diego Morales', 'c10', 'steady'), S('chloe', 'Chloe Turner', 'c10', 'skimmer'), S('ethan', 'Ethan Wallace', 'c10', 'struggling'), S('jada', 'Jada Washington', 'c10', 'steady'), S('mason', 'Mason Clark', 'c10', 'inactive'),
]
export const PARENTS_SEED = [
  { id: 'p-chen', name: 'Priya Chen', kids: ['s-maya', 's-daniel'] }, { id: 'p-brooks', name: 'Marcus Brooks', kids: ['s-noah'] },
  { id: 'p-reyes', name: 'Elena Reyes', kids: ['s-sofia'] }, { id: 'p-carter', name: 'Denise Carter', kids: ['s-jamal'] },
  { id: 'p-lee', name: 'David Lee', kids: ['s-hannah'] }, { id: 'p-morales', name: 'Rosa Morales', kids: ['s-diego'] },
]

// Live roster: starts as the seed, replaced in place by the cloud roster on hydration.
export let CLASSES = CLASSES_SEED.slice()
export let TEACHERS = TEACHERS_SEED.slice()
export let STUDENTS = STUDENTS_SEED.slice()
export let PARENTS = PARENTS_SEED.slice()
export const student = id => STUDENTS.find(s => s.id === id)
export const klass = id => CLASSES.find(c => c.id === id)
export const teacherOf = cls => TEACHERS.find(t => t.id === klass(cls).teacher)
export const firstName = s => s.name.split(' ')[0]
export const parentsOf = id => PARENTS.filter(p => p.kids.includes(id))
export const studentsIn = cls => STUDENTS.filter(s => s.cls === cls)
export const bandOf = s => klass(s.cls).band

// ---- profile (who is using the app) ----
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage can be blocked */ } window.dispatchEvent(new Event('sa-people')) }
export function getProfile() {
  const id = read('sa-profile', null)
  const st = student(id), pa = PARENTS.find(p => p.id === id), te = TEACHERS.find(t => t.id === id)
  if (st) return { role: 'student', id, name: st.name, st }
  if (pa) return { role: 'parent', id, name: pa.name, pa }
  if (te) return { role: 'teacher', id, name: te.name, te }
  return { role: 'guest', id: 'guest', name: 'Guest' }
}
export const setProfile = id => write('sa-profile', id || null)

// ---- cloud hydration -------------------------------------------------------
// A synchronous cache the render paths read. Seed/local-dev uses the sample
// generators below; once the data API answers, these caches hold cloud data.
let hydrated = false
const cloudSessions = new Map()   // studentId -> [session]
const cloudAssign = new Map()     // studentId -> [assignment]
const cloudPractice = new Map()   // studentId -> { word -> {k,m,at} }

export const isHydrated = () => hydrated

// Called once at startup (engine.js init). Pulls the roster and, for each
// student, their sessions/assignments/practice into the caches, then fires
// `sa-people` so the open view re-renders with real data. No-op (keeps the
// sample roster) when no data API is configured.
export async function hydratePeople() {
  if (!hasDataApi() || hydrated) { hydrated = true; return }
  const roster = await getRoster()
  if (roster && (roster.students || []).length) {
    if (roster.classes.length) CLASSES = roster.classes
    if (roster.teachers.length) TEACHERS = roster.teachers
    STUDENTS = roster.students
    if (roster.parents.length) PARENTS = roster.parents
  }
  await Promise.all(STUDENTS.map(async st => {
    const [ses, asg, prac] = await Promise.all([getSessions(st.id), getAssignments(st.id), getPractice(st.id)])
    if (ses) cloudSessions.set(st.id, ses)
    if (asg) cloudAssign.set(st.id, asg)
    if (prac) { const m = {}; for (const p of prac) m[p.word] = { k: p.k || 0, m: p.m || 0, at: p.at }; cloudPractice.set(st.id, m) }
  }))
  hydrated = true
  window.dispatchEvent(new Event('sa-people'))
}

// ---- sample history ----
function rng(seed) {
  let a = [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const ARCH = {
  steady: { n: [7, 9], ratio: [0.9, 1.35], q: [68, 90], wf: [0.6, 0.9], gap: [0, 3] },
  strong: { n: [9, 11], ratio: [0.95, 1.25], q: [85, 100], wf: [0.85, 1], gap: [0, 2], up: true },
  skimmer: { n: [6, 8], ratio: [0.3, 0.55], q: [38, 62], wf: [0.05, 0.4], gap: [0, 4] },
  struggling: { n: [4, 6], ratio: [1.7, 2.5], q: [30, 55], wf: [0.4, 0.7], gap: [1, 5] },
  inactive: { n: [3, 4], ratio: [0.9, 1.3], q: [60, 85], wf: [0.5, 0.8], gap: [12, 20] },
}
const DAY = 86400000
const cache = new Map()
function sample(st) {
  if (cache.has(st.id)) return cache.get(st.id)
  const r = rng(st.id), A = ARCH[st.arch], rr = (a, b) => a + r() * (b - a), ri = (a, b) => Math.floor(rr(a, b + 1))
  const band = bandOf(st), list = byBand(band)
  const n = ri(A.n[0], A.n[1]), out = []
  let ago = rr(A.gap[0], A.gap[1])
  const order = [...list].sort(() => r() - 0.5)
  for (let i = 0; i < n; i++) {
    let e = order[i % order.length]
    if (A.up && i > 0 && i % 4 === 0) e = stepUp(e.pid) || e
    const minutes = Math.max(0.5, Math.round(e.minutes * rr(A.ratio[0], A.ratio[1]) * 10) / 10)
    const w = e.vocab.map(v => v.w).sort(() => r() - 0.5)
    const words = w.slice(0, Math.round(rr(A.wf[0], A.wf[1]) * w.length))
    const source = r() < 0.5 ? 'assigned' : 'independent'
    const q = e.questions ? Math.round(rr(A.q[0], A.q[1])) : null
    const hour = source === 'assigned' ? ri(9, 14) : ri(16, 20)
    const at = new Date(Date.now() - ago * DAY); at.setHours(hour, ri(0, 59), 0, 0)
    out.push({ id: `${st.id}-${i}`, student: st.id, pid: e.pid, at: at.toISOString(), minutes, words, q, source, stars: 1 + (words.length >= 2 ? 1 : 0) + (q != null && q >= 80 ? 1 : 0) })
    ago += rr(1.5, 4.2)
  }
  cache.set(st.id, out)
  return out
}

// ---- reading sessions ----
// With the data API: sessions live in the cloud (cloudSessions cache); a new
// read is POSTed and added to the cache optimistically. Without it: kept in
// localStorage on top of the per-student sample history, as before.
export const loadSessions = () => read('sa-sessions', [])
export function addSession(rec) {
  if (hasDataApi()) {
    const list = cloudSessions.get(rec.student) || []
    const optimistic = { id: 'r' + Date.now(), ...rec }
    cloudSessions.set(rec.student, [optimistic, ...list])
    postSession(rec).then(saved => {
      if (!saved) return
      const cur = cloudSessions.get(rec.student) || []
      cloudSessions.set(rec.student, cur.map(s => (s === optimistic ? saved : s)))
      window.dispatchEvent(new Event('sa-people'))
    })
    window.dispatchEvent(new Event('sa-people'))
    return
  }
  write('sa-sessions', [...loadSessions(), { id: 'r' + Date.now(), ...rec }].slice(-300))
}
export function setSessionQuiz(student, pid, pct) {
  if (hasDataApi()) {
    // The session was just POSTed; reflect the quiz score in the cache. (The
    // reading POST already carried its stars; the score is a local refinement.)
    const list = cloudSessions.get(student) || []
    for (const s of list) if (s.pid === pid && s.q == null) { s.q = pct; s.stars = Math.max(s.stars || 1, 1 + ((s.words || []).length >= 2 ? 1 : 0) + (pct >= 80 ? 1 : 0)); break }
    window.dispatchEvent(new Event('sa-people'))
    return
  }
  const all = loadSessions()
  for (let i = all.length - 1; i >= 0; i--) if (all[i].student === student && all[i].pid === pid) { all[i].q = pct; all[i].stars = Math.max(all[i].stars, 1 + (all[i].words.length >= 2 ? 1 : 0) + (pct >= 80 ? 1 : 0)); break }
  write('sa-sessions', all)
}
export function sessionsFor(studentId) {
  if (hasDataApi()) return (cloudSessions.get(studentId) || []).slice().sort((a, b) => (a.at < b.at ? 1 : -1))
  const st = student(studentId)
  const real = loadSessions().filter(s => s.student === studentId)
  return [...(st ? sample(st) : []), ...real].sort((a, b) => (a.at < b.at ? 1 : -1))
}
export const clearSessions = () => write('sa-sessions', [])

// ---- assignments (pushed by a teacher or parent) ----
export const loadAssign = () => read('sa-assign', [])
export function assign({ pid, to, by, byName, due }) {
  const rec = { pid, to, by, byName, at: new Date().toISOString(), due: due || new Date(Date.now() + 5 * DAY).toISOString() }
  if (hasDataApi()) {
    const optimistic = { id: 'a' + Date.now() + Math.floor(Math.random() * 99), ...rec }
    cloudAssign.set(to, [...(cloudAssign.get(to) || []), optimistic])
    postAssignment(rec).then(saved => {
      if (!saved) return
      const cur = cloudAssign.get(to) || []
      cloudAssign.set(to, cur.map(a => (a === optimistic ? saved : a)))
      window.dispatchEvent(new Event('sa-people'))
    })
    window.dispatchEvent(new Event('sa-people'))
    return
  }
  write('sa-assign', [...loadAssign(), { id: 'a' + Date.now() + Math.floor(Math.random() * 99), ...rec }])
}
export function unassign(id) {
  if (hasDataApi()) {
    for (const [k, list] of cloudAssign) cloudAssign.set(k, list.filter(a => a.id !== id))
    deleteAssignment(id)
    window.dispatchEvent(new Event('sa-people'))
    return
  }
  write('sa-assign', loadAssign().filter(a => a.id !== id))
}
function seeded(st) {
  const r = rng('as' + st.id), list = byBand(bandOf(st)), t = teacherOf(st.cls)
  const done = new Set(sample(st).map(s => s.pid))
  let pick = list.filter(e => !done.has(e.pid)).sort(() => r() - 0.5).slice(0, st.arch === 'inactive' ? 1 : 2)
  if (!pick.length) { const last = sample(st)[0], up = last && stepUp(last.pid); pick = up ? [up] : [list[0]] }
  return pick.map((e, i) => ({ id: `seed-${st.id}-${i}`, pid: e.pid, to: st.id, by: t.id, byName: t.name, at: new Date(Date.now() - (2 + i) * DAY).toISOString(), due: new Date(Date.now() + (3 + i * 3) * DAY).toISOString(), seed: true }))
}
// Everything assigned to one student, with whether it has been read since it was assigned.
export function assignmentsFor(studentId) {
  const st = student(studentId), ses = sessionsFor(studentId)
  const mine = hasDataApi()
    ? (cloudAssign.get(studentId) || [])
    : [...(st ? seeded(st) : []), ...loadAssign().filter(a => a.to === studentId || (st && a.to === 'c:' + st.cls))]
  return mine.map(a => ({ ...a, done: ses.some(s => s.pid === a.pid && s.at >= a.at) })).sort((a, b) => (a.due < b.due ? -1 : 1))
}
export const upNext = id => assignmentsFor(id).filter(a => !a.done)

// ---- words ----
export const loadPractice = () => read('sa-practice', {})
// Practice tallies per student: {studentId: {word: {k, m, at}}}. Cloud when configured.
function practiceMap(studentId) {
  return hasDataApi() ? (cloudPractice.get(studentId) || {}) : (loadPractice()[studentId] || {})
}
export function recordPractice(studentId, word, knew) {
  const key = word.toLowerCase()
  if (hasDataApi()) {
    const m = cloudPractice.get(studentId) || {}
    const w = m[key] || { k: 0, m: 0 }
    if (knew) w.k++; else w.m++
    w.at = new Date().toISOString(); m[key] = w; cloudPractice.set(studentId, m)
    postPractice(studentId, key, !!knew)
    window.dispatchEvent(new Event('sa-people'))
    return
  }
  const p = loadPractice(); const m = (p[studentId] = p[studentId] || {}); const w = (m[key] = m[key] || { k: 0, m: 0 })
  if (knew) w.k++; else w.m++
  w.at = new Date().toISOString(); write('sa-practice', p)
}
const daysSince = iso => (Date.now() - new Date(iso).getTime()) / DAY
export function wordStats(studentId) {
  const map = new Map(), pr = practiceMap(studentId)
  for (const s of sessionsFor(studentId)) {
    const e = byPid(s.pid); if (!e) continue
    for (const w of s.words) {
      const v = e.vocab.find(x => x.w.toLowerCase() === w.toLowerCase())
      const k = w.toLowerCase(), cur = map.get(k) || { w, def: v ? v.def : '', ex: v ? v.ex : '', count: 0, last: s.at, pids: [] }
      cur.count++; if (s.at > cur.last) cur.last = s.at; if (!cur.pids.includes(s.pid)) cur.pids.push(s.pid); map.set(k, cur)
    }
  }
  // Words in passages the student read but did not open a card for are not counted as covered.
  return [...map.values()].map(x => {
    const p = pr[x.w.toLowerCase()] || { k: 0, m: 0 }
    const strength = Math.max(0, Math.min(3, x.count + p.k - p.m))
    const last = p.at && p.at > x.last ? p.at : x.last
    return { ...x, strength, last, due: strength < 3 && (strength <= 1 || daysSince(last) >= 7) }
  }).sort((a, b) => a.strength - b.strength || (a.last < b.last ? -1 : 1))
}

// ---- summaries ----
export function summary(studentId) {
  const ses = sessionsFor(studentId), words = wordStats(studentId)
  const qs = ses.filter(s => s.q != null)
  const ratios = ses.map(s => { const e = byPid(s.pid); return e ? s.minutes / e.minutes : 1 })
  const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
  return {
    sessions: ses, passages: new Set(ses.map(s => s.pid)).size, minutes: Math.round(ses.reduce((n, s) => n + s.minutes, 0)),
    ratio: avg(ratios), q: qs.length ? Math.round(avg(qs.map(s => s.q))) : null, words, wordsCovered: words.length, due: words.filter(w => w.due),
    lastDays: ses.length ? Math.floor(daysSince(ses[0].at)) : null, week: ses.filter(s => daysSince(s.at) <= 7).length,
    open: upNext(studentId), stars: ses.reduce((n, s) => n + s.stars, 0),
  }
}
export function classSummary(cls) {
  const studs = studentsIn(cls), sums = studs.map(s => ({ s, m: summary(s.id) }))
  const wc = new Map()
  sums.forEach(({ m }) => m.words.forEach(w => { if (w.strength <= 1) { const c = wc.get(w.w.toLowerCase()) || { w: w.w, n: 0, def: w.def }; c.n++; wc.set(w.w.toLowerCase(), c) } }))
  const pass = new Map()
  sums.forEach(({ m }) => m.sessions.forEach(s => { const c = pass.get(s.pid) || { pid: s.pid, reads: 0, minutes: 0, q: [] }; c.reads++; c.minutes += s.minutes; if (s.q != null) c.q.push(s.q); pass.set(s.pid, c) }))
  const avg = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null)
  return {
    sums, active: sums.filter(x => x.m.lastDays != null && x.m.lastDays <= 7).length, total: studs.length,
    minutes: sums.reduce((n, x) => n + x.m.minutes, 0), passages: sums.reduce((n, x) => n + x.m.sessions.length, 0),
    q: avg(sums.filter(x => x.m.q != null).map(x => x.m.q)), openAssign: sums.reduce((n, x) => n + x.m.open.length, 0),
    hardWords: [...wc.values()].sort((a, b) => b.n - a.n).slice(0, 6),
    passageRows: [...pass.values()].map(c => ({ pid: c.pid, reads: c.reads, minutes: Math.round(10 * c.minutes / c.reads) / 10, q: avg(c.q) })).sort((a, b) => b.reads - a.reads),
  }
}

// ---- suggestions (rules, not AI) ----
// Each suggestion is { k: key, a: args, act?: { type, ... } } and the interface turns it into a sentence.
export function studentTips(studentId, who) {
  const st = student(studentId), m = summary(studentId), tips = [], band = st ? bandOf(st) : 'k2'
  const next = (() => { const read = new Set(m.sessions.map(s => s.pid)); return byBand(band).find(e => !read.has(e.pid)) || byBand(band)[0] })()
  if (m.due.length) tips.push({ k: 'words', a: [m.due.slice(0, 4).map(w => w.w)], act: { type: 'practice', words: m.due.slice(0, 6).map(w => w.w) } })
  if (m.lastDays != null && m.lastDays >= 10) tips.push({ k: 'inactive', a: [m.lastDays, next && next.title], act: next && { type: 'assign', pid: next.pid } })
  else if (m.ratio != null && m.ratio < 0.65 && m.q != null && m.q < 70) tips.push({ k: 'skim', a: [], act: next && { type: 'assign', pid: next.pid } })
  else if (m.ratio != null && m.ratio > 1.5 && m.q != null && m.q < 65) {
    const lower = CATALOG.filter(e => gradeNum(e) < gradeNum(byBand(band)[0] || e)).sort((a, b) => gradeNum(b) - gradeNum(a))[0]
    tips.push({ k: 'slow', a: [lower ? lower.title : null], act: lower && { type: 'assign', pid: lower.pid } })
  } else if (m.q != null && m.q >= 85 && m.sessions.length >= 4) {
    const up = byBand(band).length ? stepUp(m.sessions[0].pid) : null
    tips.push({ k: 'strong', a: [up && up.title], act: up && { type: 'assign', pid: up.pid } })
  }
  if (m.sessions.length && m.wordsCovered / Math.max(1, m.sessions.length) < 1.5 && m.lastDays != null && m.lastDays < 10) tips.push({ k: 'fewwords', a: [] })
  if (who === 'parent' && m.sessions.length) { const e = byPid(m.sessions[0].pid); if (e) tips.push({ k: 'talk', a: [e.title] }) }
  if (!tips.length) tips.push({ k: 'good', a: [] })
  return tips
}
export function classTips(cls) {
  const c = classSummary(cls), tips = []
  const quiet = c.sums.filter(x => x.m.lastDays == null || x.m.lastDays >= 10)
  if (c.hardWords.length) tips.push({ k: 'cwords', a: [c.hardWords.slice(0, 4).map(w => w.w)] })
  if (quiet.length) tips.push({ k: 'cquiet', a: [quiet.length, quiet.slice(0, 3).map(x => firstName(x.s))] })
  const low = c.passageRows.filter(p => p.q != null && p.q < 65 && p.reads >= 2).sort((a, b) => a.q - b.q)[0]
  if (low) tips.push({ k: 'clow', a: [byPid(low.pid).title, low.q] })
  const skim = c.sums.filter(x => x.m.ratio != null && x.m.ratio < 0.65 && x.m.q != null && x.m.q < 70)
  if (skim.length) tips.push({ k: 'cskim', a: [skim.length, skim.slice(0, 3).map(x => firstName(x.s))] })
  const strong = c.sums.filter(x => x.m.q != null && x.m.q >= 85 && x.m.sessions.length >= 4)
  if (strong.length) tips.push({ k: 'cstrong', a: [strong.length, strong.slice(0, 3).map(x => firstName(x.s))] })
  if (!tips.length) tips.push({ k: 'cgood', a: [] })
  return tips
}
export const fmtMin = m => (m < 1 ? Math.max(1, Math.round(m * 60)) + ' s' : (Math.round(m * 10) / 10) + ' min')
