// Top navigation: the My Tools drop-down and the menu button used on phones.
export function initNav() {
  const tools = document.getElementById('navTools'), menu = document.getElementById('toolsMenu')
  const burger = document.getElementById('navBurger'), links = document.getElementById('navLinks')
  const closeTools = (refocus) => { if (menu.hidden) return; menu.hidden = true; tools.setAttribute('aria-expanded', 'false'); if (refocus) tools.focus({ preventScroll: true }) }
  const closeNav = () => { document.body.classList.remove('nav-open'); burger.setAttribute('aria-expanded', 'false') }
  tools.addEventListener('click', e => { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; tools.setAttribute('aria-expanded', String(open)); if (open) { const f = menu.querySelector('button'); if (f) f.focus({ preventScroll: true }) } })
  menu.addEventListener('click', () => { closeTools(false); closeNav() })
  burger.addEventListener('click', () => { const open = !document.body.classList.contains('nav-open'); document.body.classList.toggle('nav-open', open); burger.setAttribute('aria-expanded', String(open)) })
  links.addEventListener('click', e => { if (e.target.closest('.rwlink:not(#navTools), .rwsmall')) closeNav() })
  document.addEventListener('click', e => { if (!e.target.closest('.rwmenu')) closeTools(false) })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!menu.hidden) closeTools(true); closeNav() } })
}
