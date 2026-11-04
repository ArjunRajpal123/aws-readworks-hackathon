import { test, expect, openApp, tr, activeIndex } from './fixtures.js'

const meta = { tag: ['@a11y-settings', '@mobile'], annotation: [
  { type: 'area', description: 'Accessibility panel, theme toggle, dark reading, persistence' },
  { type: 'files', description: 'frontend/src/engine.js (A, applyA, applyTheme, markSentence, placeStrip, followWord, a11yBtn/themeBtn/darkBtn handlers); frontend/src/style.css; frontend/src/App.vue' },
] }

const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('ws-a11y') || '{}'))

test.describe('Accessibility settings', meta, () => {
  test('panel opens, focuses the size control and closes', async ({ page }) => {
    await openApp(page, '35')
    const btn = page.locator('#a11yBtn')
    await expect(page.locator('#a11y')).toBeHidden()
    await btn.click()
    await expect(page.locator('#a11y')).toBeVisible()
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('#a-size-m')).toBeFocused()
    await btn.click()
    await expect(page.locator('#a11y')).toBeHidden()
    await expect(btn).toHaveAttribute('aria-expanded', 'false')
  })

  test('text size changes the passage font size', async ({ page }) => {
    await openApp(page, '35')
    await page.locator('#a11yBtn').click()
    const size = () => page.locator('#page p').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize))
    const m = await size()
    await page.locator('#a-size-l').check()
    await expect(page.locator('body')).toHaveAttribute('data-size', 'l')
    const l = await size()
    await page.locator('#a-size-xl').check()
    const xl = await size()
    expect(l).toBeGreaterThan(m)
    expect(xl).toBeGreaterThan(l)
    await expect(page.locator('#a11yBtn')).not.toHaveClass(/\boff\b/) // button shows settings are active
  })

  for (const k of ['font', 'spacing', 'contrast', 'motion']) {
    test(`${k} toggle adds body.a-${k} and persists`, async ({ page }) => {
      await openApp(page, '35')
      await page.locator('#a11yBtn').click()
      await page.locator(`#a-${k}`).check()
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\ba-${k}\\b`))
      expect((await stored(page))[k]).toBe(true)
      await page.reload()
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\ba-${k}\\b`))
    })
  }

  test('display settings survive switching grade band, language, Word Stops and game features', async ({ page }) => {
    await openApp(page, '35')
    await page.locator('#a11yBtn').click()
    await page.locator('#a-contrast').check()
    await page.locator('#a-font').check()
    const keep = async step => {
      await expect(page.locator('body'), `after ${step}`).toHaveClass(/\ba-contrast\b/)
      await expect(page.locator('body'), `after ${step}`).toHaveClass(/\ba-font\b/)
    }
    await keep('checking the boxes')
    await page.locator('#tabs .tab[data-id="68"]').click(); await keep('tab switch')
    await page.locator('.lng[data-l="es"]').click(); await keep('language switch')
    await page.locator('#stopsBtn').click(); await keep('Word Stops toggle')
    await page.locator('#gameBtn').click(); await keep('game toggle')
    await page.locator('#restart').click(); await keep('Start over')
  })

  test('easy-to-read font actually changes the passage font', async ({ page }) => {
    await openApp(page, '35')
    const fam = () => page.locator('#page p').first().evaluate(e => getComputedStyle(e).fontFamily)
    const before = await fam()
    await page.locator('#a11yBtn').click()
    await page.locator('#a-font').check()
    expect(await fam()).not.toBe(before)
  })

  test('sentence highlight marks the whole current sentence while reading', async ({ page }) => {
    await openApp(page, '35')
    await page.locator('#a11yBtn').click()
    await page.locator('#a-sentence').check()
    await page.locator('#play').click()
    await expect(page.locator('#page .w.on')).toHaveCount(1)
    await expect.poll(() => page.locator('#page .w.sent').count()).toBeGreaterThan(3)
    // "Lots of English people love tea." = 6 words
    await expect(page.locator('#page .w.sent')).toHaveCount(6)
    await page.locator('#a-sentence').uncheck()
    await expect(page.locator('#page .w.sent')).toHaveCount(0)
  })

  test('reading strip appears and follows the current line', async ({ page }) => {
    await openApp(page, '35')
    await page.locator('#a11yBtn').click()
    await page.locator('#a-strip').check()
    const strip = page.locator('#page .strip')
    await expect(strip).toHaveCount(1)
    await expect(strip).toHaveAttribute('aria-hidden', 'true')
    const top0 = await strip.evaluate(e => parseFloat(e.style.top))
    await page.locator('#page .w').nth(80).click()
    await expect.poll(() => activeIndex(page)).toBeGreaterThanOrEqual(80)
    const top1 = await strip.evaluate(e => parseFloat(e.style.top))
    expect(top1).toBeGreaterThan(top0)
    await page.locator('#a-strip').uncheck()
    await expect(strip).toHaveCount(0)
  })

  test('theme: radio buttons, header toggle and device preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await openApp(page, '35')
    const html = page.locator('html')
    await expect(html).toHaveAttribute('data-theme', 'dark') // auto follows the device
    await expect(page.locator('#themeBtn')).toHaveText(tr('en', 'toLight'))
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(html).toHaveAttribute('data-theme', 'light') // live update on device change
    await page.locator('#themeBtn').click()
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('#themeBtn')).toHaveAttribute('aria-pressed', 'true')
    await page.locator('#a11yBtn').click()
    await expect(page.locator('#a-theme-dark')).toBeChecked()
    await page.locator('#a-theme-light').check()
    await expect(html).toHaveAttribute('data-theme', 'light')
    const bg = await page.locator('body').evaluate(e => getComputedStyle(e).backgroundColor)
    await page.locator('#a-theme-dark').check()
    expect(await page.locator('body').evaluate(e => getComputedStyle(e).backgroundColor)).not.toBe(bg)
    await page.reload()
    await expect(html).toHaveAttribute('data-theme', 'dark')
  })

  test('device reduced-motion preference turns on Reduce motion by default', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page, '35')
    await expect(page.locator('body')).toHaveClass(/\ba-motion\b/)
  })

  test('Reset restores every setting to its default', async ({ page }) => {
    await openApp(page, '35')
    await page.locator('#a11yBtn').click()
    await page.locator('#a-size-xl').check()
    for (const k of ['font', 'spacing', 'sentence', 'strip', 'contrast', 'motion', 'readq']) await page.locator(`#a-${k}`).check()
    await page.locator('#a-follow').uncheck()
    await page.locator('#a-theme-dark').check()
    await page.locator('#a-reset').click()
    await expect(page.locator('#a-size-m')).toBeChecked()
    await expect(page.locator('#a-theme-auto')).toBeChecked()
    await expect(page.locator('#a-follow')).toBeChecked()
    for (const k of ['font', 'spacing', 'sentence', 'strip', 'contrast', 'motion', 'readq']) await expect(page.locator(`#a-${k}`)).not.toBeChecked()
    await expect(page.locator('body')).toHaveAttribute('data-size', 'm')
    await expect(page.locator('#a11yBtn')).toHaveClass(/\boff\b/)
  })

  test('keep current word in view scrolls the page while reading', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 420 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page, '912')
    const last = page.locator('#page .w').last()
    await last.scrollIntoViewIfNeeded()
    await page.evaluate(() => scrollTo(0, 0))
    const target = await page.locator('#page .w').nth(150)
    await target.evaluate(e => e.click())
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0)
  })

  test('9-12 Dark reading darkens only the passage column', async ({ page }) => {
    await openApp(page, '912')
    const b = page.locator('#darkBtn')
    await b.click()
    await expect(page.locator('#col')).toHaveClass(/\bdark\b/)
    await expect(b).toHaveAttribute('aria-pressed', 'true')
    await page.locator('#tabs .tab[data-id="35"]').click()
    await expect(page.locator('#col')).not.toHaveClass(/\bdark\b/)
    await expect(b).toBeHidden()
  })
})
