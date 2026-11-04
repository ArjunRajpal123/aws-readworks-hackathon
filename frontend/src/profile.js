// "Who is using Sound Along" picker. Students, parents and teachers are linked: a parent sees their child's reading,
// a teacher sees the class, and a student sees what was assigned.
import { CLASSES, TEACHERS, STUDENTS, PARENTS, student, klass, teacherOf, parentsOf, getProfile, setProfile, firstName } from './people.js'

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function createProfile({ t, onPick }) {
  const dlg = document.createElement('dialog')
  dlg.className = 'sa-dlg pf-dlg'; dlg.id = 'profDlg'; dlg.setAttribute('aria-labelledby', 'pfT')
  document.body.appendChild(dlg)
  let cls = 'c2'
  function draw() {
    const me = getProfile()
    const row = (id, name, sub, role) => '<li><button type="button" class="pf-item' + (me.id === id ? ' cur' : '') + '" data-pick="' + id + '" aria-pressed="' + (me.id === id) + '"><span class="pf-av pf-' + role + '" aria-hidden="true">' + esc(name.split(' ').map(x => x[0]).slice(0, 2).join('')) + '</span><span><b>' + esc(name) + '</b><span class="fm-sub">' + esc(sub) + '</span></span></button></li>'
    dlg.innerHTML = '<button type="button" class="dlg-x" aria-label="' + esc(t('infoClose')) + '" data-close="1">×</button><h2 id="pfT">' + esc(t('pfTitle')) + '</h2><p class="fm-sub">' + esc(t('pfIntro')) + '</p>'
      + '<ul class="pf-list"><li><button type="button" class="pf-item' + (me.role === 'guest' ? ' cur' : '') + '" data-pick="" aria-pressed="' + (me.role === 'guest') + '"><span class="pf-av pf-guest" aria-hidden="true">G</span><span><b>' + esc(t('pfGuest')) + '</b><span class="fm-sub">' + esc(t('pfGuestSub')) + '</span></span></button></li></ul>'
      + '<h3>' + esc(t('pfStudents')) + '</h3><div class="fm-pick" role="tablist">' + CLASSES.map(c => '<button type="button" role="tab" data-pcls="' + c.id + '" aria-selected="' + (cls === c.id) + '">' + esc(t('fClassShort', c.grade)) + '</button>').join('') + '</div>'
      + '<ul class="pf-list">' + STUDENTS.filter(s => s.cls === cls).map(s => row(s.id, s.name, t('pfStudentSub', klass(s.cls).grade, teacherOf(s.cls).name, parentsOf(s.id).map(p => p.name).join(', ') || '—'), 'student')).join('') + '</ul>'
      + '<h3>' + esc(t('pfParents')) + '</h3><ul class="pf-list">' + PARENTS.map(p => row(p.id, p.name, t('pfParentSub', p.kids.map(k => firstName(student(k))).join(', ')), 'parent')).join('') + '</ul>'
      + '<h3>' + esc(t('pfTeachers')) + '</h3><ul class="pf-list">' + TEACHERS.map(x => row(x.id, x.name, t('pfTeacherSub', klass(x.cls).name, klass(x.cls).grade), 'teacher')).join('') + '</ul>'
  }
  dlg.addEventListener('click', e => {
    if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return }
    const c = e.target.closest('[data-pcls]')
    if (c) { cls = c.dataset.pcls; draw(); return }
    const p = e.target.closest('[data-pick]')
    if (p) { setProfile(p.dataset.pick); dlg.close(); onPick(getProfile()) }
  })
  function open() {
    const me = getProfile(); if (me.role === 'student') cls = me.st.cls
    draw(); dlg.showModal(); dlg.scrollTop = 0
    const h = dlg.querySelector('#pfT'); h.tabIndex = -1; h.focus({ preventScroll: true })
  }
  return { open }
}
