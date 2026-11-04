import { test, expect, openApp, PASSAGES, MODES, CARDS, ACCENTS, uiLangOf, tr, modeById } from './fixtures.js'

const meta = { tag: ['@game'], annotation: [
  { type: 'area', description: 'Optional game add-on: glow jar (K-2), badges (3-5), moves/streak/colour (6-8), word bank (9-12)' },
  { type: 'files', description: 'frontend/src/engine.js (syncGame, renderReward, collect, reveal, glowMood); frontend/src/data.js (ACCENTS, JAR, BADGE)' },
] }

async function gameOn(page) {
  const b = page.locator('#gameBtn')
  await b.click()
  await expect(b).toHaveAttribute('aria-pressed', 'true')
}
async function solveChoice(page, m, k) {
  await page.locator('#page .w.stopw').nth(k).click()
  await page.locator('#stopBox .choice', { hasText: m.stops[k].choices.find(c => c.ok).t }).click()
}

test.describe('Game features', meta, () => {
  test('toggle shows/hides the reward panel and persists across reload', async ({ page }) => {
    await openApp(page, 'k2')
    await expect(page.locator('#gameBtn')).toHaveText(tr('en', 'gameBtn', false))
    await expect(page.locator('#rewardWrap')).toBeHidden()
    await gameOn(page)
    await expect(page.locator('#gameBtn')).toHaveText(tr('en', 'gameBtn', true))
    await expect(page.locator('#rewardWrap')).toBeVisible()
    await expect(page.locator('#rewardTitle')).toHaveText(modeById('k2').reward)
    await page.reload()
    await expect(page.locator('#gameBtn')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#rewardWrap')).toBeVisible()
  })

  test('K-2 glow jar: answering the stop and tapping vocab add words; jar words are spoken', async ({ page }) => {
    const m = modeById('k2')
    await openApp(page, 'k2')
    await gameOn(page)
    await expect(page.locator('#reward .hint')).toHaveText(tr('en', 'jarHint'))
    await page.locator('#page .w.stopw').first().click()
    await page.locator('#stopBox .choice', { hasText: m.stops[0].choices.find(c => c.ok).t }).click()
    await expect(page.locator('#stopBox .fb.ok')).toHaveText(m.stops[0].right) // game copy, not rightPlain
    await expect(page.locator('#reward .jarword')).toHaveText(['nature'])
    await page.locator('#page .w.vocab', { hasText: 'visit' }).click()
    await expect(page.locator('#reward .jarword')).toHaveText(['nature', 'visit'])
    await page.locator('#page .w.vocab', { hasText: 'visit' }).click()
    await expect(page.locator('#reward .jarword')).toHaveCount(2) // no duplicates
    await page.evaluate(() => { window.__spoken.length = 0 })
    await page.locator('#reward .jarword', { hasText: 'nature' }).click()
    await expect.poll(() => page.evaluate(() => window.__spoken.map(s => s.text))).toEqual(['nature'])
  })

  test('3-5 badges and SOLVED stamp', async ({ page }) => {
    const m = modeById('35')
    await openApp(page, '35')
    await gameOn(page)
    await expect(page.locator('#reward .badge')).toHaveCount(3)
    await expect(page.locator('#reward .badge.got')).toHaveCount(0)
    await solveChoice(page, m, 0)
    await expect(page.locator('#stopBox .stamp')).toHaveText(tr('en', 'solved'))
    await expect(page.locator('#reward .badge.got')).toHaveCount(1)
    await solveChoice(page, m, 1)
    await expect(page.locator('#reward .badge.got')).toHaveCount(2)
  })

  test('6-8 first-try streak, move counts and colour picker', async ({ page }) => {
    const m = modeById('68')
    await openApp(page, '68')
    await gameOn(page)
    await expect(page.locator('#reward .streak b')).toHaveText('0')
    await solveChoice(page, m, 0)
    await expect(page.locator('#reward .streak b')).toHaveText('1')
    await expect(page.locator('#reward .mv', { hasText: m.stops[0].move }).locator('b')).toHaveText('× 1')
    // colour swatches: pick each, the accent variable follows and survives reload
    const sw = page.locator('#reward .sw')
    await expect(sw).toHaveCount(ACCENTS.length)
    await sw.nth(2).click()
    const acc = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--acc').trim())
    await expect.poll(acc).toBe(ACCENTS[2][0])
    await expect(page.locator('#reward .sw').nth(2)).toHaveAttribute('aria-pressed', 'true')
    await page.reload()
    await expect.poll(acc).toBe(ACCENTS[2][0])
  })

  test('6-8 a wrong first answer breaks the streak', async ({ page }) => {
    const m = modeById('68')
    await openApp(page, '68')
    await gameOn(page)
    await page.locator('#page .w.stopw').first().click()
    await page.locator('#stopBox .choice', { hasText: m.stops[0].choices.find(c => !c.ok).t }).click()
    await page.locator('#stopBox .choice', { hasText: m.stops[0].choices.find(c => c.ok).t }).click()
    await expect(page.locator('#reward .streak b')).toHaveText('0')
  })

  test('9-12 word bank fills and Copy word bank writes it to the clipboard', async ({ page, context, browserName }) => {
    const m = modeById('912')
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page, '912')
    await gameOn(page)
    await expect(page.locator('#reward .hint')).toHaveText(tr('en', 'bankHint'))
    await solveChoice(page, m, 0)
    await expect(page.locator('#stopBox .resolved')).toHaveText(tr('en', 'resolvedBank'))
    await expect(page.locator('#reward .bw b')).toHaveText([CARDS[m.stops[0].word].word])
    await page.locator('#copyBank').click()
    await expect(page.locator('#copyBank')).toHaveText(tr('en', 'copied'))
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toContain(CARDS[m.stops[0].word].word + ': ' + CARDS[m.stops[0].word].def)
  })

  for (const m of PASSAGES.filter(x => x.lang === 'es-US')) {
    test(`${m.id}: reward panel title is localised`, async ({ page }) => {
      await openApp(page, m.id)
      await gameOn(page)
      await expect(page.locator('#rewardTitle')).toHaveText(m.reward)
      await expect(page.locator('#gameBtn')).toHaveText(tr(uiLangOf(m), 'gameBtn', true))
    })
  }
})
