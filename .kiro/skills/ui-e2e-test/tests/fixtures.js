// Shared fixtures for the Sound Along UI suite.
//
// - Replaces window.speechSynthesis with a recorder. Every utterance is logged to
//   window.__spoken and then fails with 'synthesis-failed', which makes the player
//   fall back to its deterministic word timer (60000 / (165 * rate) ms per word).
//   Tests stay fast and repeatable, and can still assert what the app tried to say.
// - Fails any test that throws an uncaught page error or logs console.error
//   (missing optional files under sa/ are expected and ignored).
// - Exposes the app's own data (MODES, CARDS, I18N) so tests are driven by the
//   same content the UI renders.
import { test as base, expect } from '@playwright/test'
import { MODES, CARDS, ACCENTS } from '../../../../frontend/src/data.js'
import { I18N } from '../../../../frontend/src/i18n.js'

export { expect, MODES, CARDS, ACCENTS, I18N }

export const BANDS = ['k2', '35', '68', '912']

// Which passages the data-driven loops cover. The hand-built demo passages (no "rw" prefix)
// are always tested in full. Generated families (rw-*, rwf-*, ...) can run to hundreds,
// so by default only the first SA_UI_SAMPLE ids of each family are included.
// SA_UI_ALL=1 tests every passage.
const family = id => (id.match(/^([a-z]+)-/) || [])[1] || ''
const SAMPLE = Number(process.env.SA_UI_SAMPLE || 2)
export const PASSAGES = process.env.SA_UI_ALL === '1' ? MODES : (() => {
  const seen = {}
  return MODES.filter(m => { const f = family(m.id); if (!f) return true; seen[f] = (seen[f] || 0) + 1; return seen[f] <= SAMPLE })
})()
export const bandOf = m => m.band || m.id
export const uiLangOf = m => (m.lang === 'es-US' ? 'es' : 'en')
export const modeById = id => MODES.find(m => m.id === id)
export function tr(lang, key, ...args) {
  const v = I18N[lang] && I18N[lang][key] !== undefined ? I18N[lang][key] : I18N.en[key]
  return typeof v === 'function' ? v(...args) : v
}

const IGNORED_CONSOLE = [
  /Failed to load resource.*404/i, // optional sa/product/<id>.soundAlong.json for demo passages
]

function fakeSpeech() {
  window.__spoken = []
  const fake = {
    speaking: false, pending: false, paused: false,
    speak(u) {
      window.__spoken.push({ text: u.text, lang: u.lang, rate: u.rate })
      setTimeout(() => u.onerror && u.onerror({ error: 'synthesis-failed' }), 0)
    },
    cancel() {}, pause() {}, resume() {}, getVoices: () => [],
    addEventListener() {}, removeEventListener() {},
  }
  Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true })
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const problems = []
    page.on('pageerror', e => problems.push(`pageerror: ${e.message}`))
    page.on('console', m => {
      if (m.type() !== 'error') return
      const text = m.text()
      if (IGNORED_CONSOLE.some(r => r.test(text))) return
      problems.push(`console.error: ${text}`)
    })
    await page.addInitScript(fakeSpeech)
    await use(page)
    if (problems.length && testInfo.status === testInfo.expectedStatus) {
      throw new Error('Page reported errors during the test:\n' + problems.join('\n'))
    }
  },
})

/** Open the app on a passage id (or the default) and wait for the passage to render. */
export async function openApp(page, id) {
  await page.goto(id ? `./?m=${encodeURIComponent(id)}` : './')
  await expect(page.locator('#page .w').first()).toBeVisible()
}

export const spoken = page => page.evaluate(() => window.__spoken.map(s => s.text))
export const activeIndex = async page => {
  const on = page.locator('#page .w.on')
  return (await on.count()) ? Number(await on.first().getAttribute('data-i')) : -1
}
/** "12 / 379 words" -> [12, 379] */
export async function counter(page) {
  const txt = await page.locator('#time').textContent()
  const m = txt.match(/(\d+)\s*\/\s*(\d+)/)
  return [Number(m[1]), Number(m[2])]
}
