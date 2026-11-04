import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')

// Fallback for the phone word panel. engine.js normally owns the open/close buttons;
// if its setup stops early on some browser, these still work so the tab never goes dead.
document.addEventListener('click', e => {
  if (window.__saSide) return
  const el = e.target && e.target.closest ? e.target.closest('#sideTab,#sideClose,#sideBackdrop') : null
  if (!el) return
  const open = el.id === 'sideTab'
  document.body.classList.toggle('side-open', open)
  const tab = document.getElementById('sideTab')
  if (tab) tab.setAttribute('aria-expanded', String(open))
}, true)
document.addEventListener('keydown', e => {
  if (window.__saSide) return
  if (e.key === 'Escape') document.body.classList.remove('side-open')
})
