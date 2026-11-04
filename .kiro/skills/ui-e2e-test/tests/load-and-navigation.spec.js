import { test, expect, openApp, PASSAGES, MODES, BANDS, bandOf, uiLangOf, modeById, tr } from './fixtures.js'

const meta = { tag: ['@smoke', '@mobile'], annotation: [
  { type: 'area', description: 'Page load, grade-band tabs, language switch, passage routing' },
  { type: 'files', description: 'frontend/src/engine.js (load, buildTabs, syncLang, applyStatic); frontend/src/App.vue; frontend/src/data.js; frontend/src/data_es.js' },
] }

test.describe('Load and navigation', meta, () => {
  test('default load shows the K-2 passage with all chrome', async ({ page }) => {
    await openApp(page)
    const k2 = modeById('k2')
    await expect(page.locator('#ptitle')).toHaveText(k2.title)
    await expect(page.locator('body')).toHaveClass(/\bb-k2\b/)
    await expect(page.locator('#tabs .tab')).toHaveCount(BANDS.length)
    await expect(page.locator('#bands li')).toHaveCount(BANDS.length)
    await expect(page.locator('#bands li.cur')).toHaveAttribute('data-id', 'k2')
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'play'))
    await expect(page.locator('#time')).toHaveText(/^0 \/ \d+ words$/)
    await expect(page.locator('#stopBox')).toHaveClass(/idle/)
    await expect(page.locator('#cardBody')).toHaveText(tr('en', 'cardIdle'))
    await expect(page.locator('#srcTag')).toHaveText(tr('en', 'srcBrowser'))
  })

  for (const m of PASSAGES) {
    test(`?m=${m.id} renders "${m.title}"`, async ({ page }) => {
      await openApp(page, m.id)
      const lang = uiLangOf(m)
      await expect(page.locator('#ptitle')).toHaveText(m.title)
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\bb-${bandOf(m)}\\b`))
      await expect(page.locator('html')).toHaveAttribute('lang', lang)
      await expect(page.locator(`#tabs .tab[data-id="${bandOf(m)}"]`)).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('#tabs .tab[aria-selected="true"]')).toHaveCount(1)
      await expect(page.locator('#stopTitle')).toHaveText(m.stopTitle)
      // every paragraph renders, word count matches the source text
      const words = m.paras.join(' ').split(/\s+/).length
      await expect(page.locator('#page .w')).toHaveCount(words)
      await expect(page.locator('#time')).toHaveText(`0 / ${words} ${tr(lang, 'words')}`)
      // details sidebar lists every row from the data plus the demo summary
      // values may contain HTML (links); compare against the rendered text
      const plain = s => String(s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&')
      for (const [k, v] of m.details) await expect(page.locator('#details')).toContainText(`${plain(k)}: ${plain(v)}`)
      await expect(page.locator('#stopBox')).toHaveText(m.stops.length ? tr(lang, 'idle', bandOf(m), false, m.stops.length) : tr(lang, 'idleNone'))
      // "Dark reading" button only exists for 9-12 English
      await expect(page.locator('#darkBtn')).toBeVisible({ visible: m.id === '912' })
    })
  }

  test('an unknown ?m= id falls back to K-2', async ({ page }) => {
    await openApp(page, 'does-not-exist')
    await expect(page.locator('#ptitle')).toHaveText(modeById('k2').title)
  })

  test('clicking each grade-band tab switches passage, look and sidebar', async ({ page }) => {
    await openApp(page)
    for (const b of BANDS) {
      await page.locator(`#tabs .tab[data-id="${b}"]`).click()
      await expect(page.locator('#ptitle')).toHaveText(modeById(b).title)
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\bb-${b}\\b`))
      await expect(page.locator(`#tabs .tab[data-id="${b}"]`)).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('#bands li.cur')).toHaveAttribute('data-id', b)
    }
  })

  test('last opened passage is restored after reload', async ({ page }) => {
    await openApp(page)
    await page.locator('#tabs .tab[data-id="68"]').click()
    await expect(page.locator('#ptitle')).toHaveText(modeById('68').title)
    await page.reload()
    await expect(page.locator('#ptitle')).toHaveText(modeById('68').title)
  })

  test('?m= wins over the remembered passage', async ({ page }) => {
    await openApp(page)
    await page.locator('#tabs .tab[data-id="35"]').click()
    await openApp(page, '912')
    await expect(page.locator('#ptitle')).toHaveText(modeById('912').title)
  })

  for (const b of BANDS) {
    test(`language toggle on ${b}: English -> Spanish -> English`, async ({ page }) => {
      await openApp(page, b)
      const es = modeById(b + 'es')
      await expect(page.locator('.lng[data-l="en"]')).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.lng[data-l="es"]')).toBeEnabled()
      await expect(page.locator('#langNote')).toBeHidden()
      await page.locator('.lng[data-l="es"]').click()
      await expect(page.locator('#ptitle')).toHaveText(es.title)
      await expect(page.locator('html')).toHaveAttribute('lang', 'es')
      await expect(page.locator('.lng[data-l="es"]')).toHaveAttribute('aria-pressed', 'true')
      // interface strings switch too
      await expect(page.locator('[data-i18n="a11yBtn"]')).toHaveText(tr('es', 'a11yBtn'))
      await expect(page.locator('#stopsBtn')).toHaveText(tr('es', 'stopsBtn', true))
      await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('es', 'play'))
      await expect(page.locator('#back5')).toHaveAttribute('aria-label', tr('es', 'back5'))
      await page.locator('.lng[data-l="en"]').click()
      await expect(page.locator('#ptitle')).toHaveText(modeById(b).title)
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')
      await expect(page.locator('[data-i18n="a11yBtn"]')).toHaveText(tr('en', 'a11yBtn'))
    })
  }

  test('switching band while in Spanish stays in Spanish', async ({ page }) => {
    await openApp(page, 'k2es')
    for (const b of ['35', '68', '912']) {
      await page.locator(`#tabs .tab[data-id="${b}"]`).click()
      await expect(page.locator('#ptitle')).toHaveText(modeById(b + 'es').title)
      await expect(page.locator(`#tabs .tab[data-id="${b}"] small`)).toHaveText(modeById(b + 'es').sub)
    }
  })
})
