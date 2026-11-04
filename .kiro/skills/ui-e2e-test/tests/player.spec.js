import { test, expect, openApp, activeIndex, counter, spoken, tr, modeById } from './fixtures.js'

const meta = { tag: ['@player', '@mobile'], annotation: [
  { type: 'area', description: 'Read-along player: play/pause, highlight, tap to replay, skip, speed, voice, keyboard' },
  { type: 'files', description: 'frontend/src/engine.js (readRange, playFrom, stopAll, pauseHere, skip, setActive, progress, keydown handlers)' },
] }

// 35 has voice 1.0 -> ~364 ms per word at 1x with the fake speech timer.
const ID = '35'

test.describe('Player', meta, () => {
  test('play highlights words in order and pause keeps the position', async ({ page }) => {
    await openApp(page, ID)
    await page.locator('#play').click()
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'pause'))
    await expect(page.locator('#page .w.on')).toHaveCount(1)
    await expect.poll(() => activeIndex(page), { timeout: 4000 }).toBeGreaterThanOrEqual(2)
    await expect(page.locator('#page .w.on')).toHaveCount(1) // never more than one word lit
    const before = await activeIndex(page)
    await expect.poll(async () => (await counter(page))[0]).toBeGreaterThan(0)
    await page.locator('#play').click()
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'play'))
    const [atPause] = await counter(page)
    await page.waitForTimeout(800)
    expect((await counter(page))[0]).toBe(atPause) // no movement while paused
    expect(atPause).toBeGreaterThanOrEqual(before)
    const progress = await page.locator('#prog').evaluate(e => parseFloat(e.style.width))
    expect(progress).toBeGreaterThan(0)
  })

  test('play after pause resumes from where it stopped, not from the start', async ({ page }) => {
    await openApp(page, ID)
    await page.locator('#play').click()
    await expect.poll(() => activeIndex(page), { timeout: 4000 }).toBeGreaterThanOrEqual(3)
    await page.locator('#play').click()
    const [at] = await counter(page)
    await page.locator('#play').click()
    await expect.poll(() => activeIndex(page)).toBeGreaterThanOrEqual(at - 1)
  })

  test('the browser voice is asked to read the passage in the passage language', async ({ page }) => {
    await openApp(page, '35es')
    await page.locator('#play').click()
    await expect.poll(async () => (await page.evaluate(() => window.__spoken)).length).toBeGreaterThan(0)
    const first = (await page.evaluate(() => window.__spoken))[0]
    expect(first.lang).toBe('es-US')
    expect(first.text.length).toBeGreaterThan(0)
  })

  test('tapping a plain word starts reading from that word', async ({ page }) => {
    await openApp(page, ID)
    const target = page.locator('#page .w:not(.vocab)').nth(20)
    const i = Number(await target.getAttribute('data-i'))
    await target.click()
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'pause'))
    await expect.poll(() => activeIndex(page)).toBeGreaterThanOrEqual(i)
    const lit = await activeIndex(page)
    expect(lit).toBeLessThan(i + 5)
  })

  test('forward and back 5 s move the position while paused', async ({ page }) => {
    await openApp(page, ID)
    await page.locator('#fwd5').click()
    const [a, n] = await counter(page)
    expect(a).toBeGreaterThan(5) // 5 s at 165 wpm is ~14 words
    expect(a).toBeLessThan(n)
    await page.locator('#fwd5').click()
    const [b] = await counter(page)
    expect(b).toBeGreaterThan(a)
    await page.locator('#back5').click()
    expect((await counter(page))[0]).toBe(a)
    await page.locator('#back5').click()
    await page.locator('#back5').click()
    expect((await counter(page))[0]).toBe(0) // clamps at the start
  })

  test('forward 5 s clamps at the last word', async ({ page }) => {
    await openApp(page, 'k2')
    for (let i = 0; i < 60; i++) await page.locator('#fwd5').click()
    const [a, n] = await counter(page)
    expect(a).toBeLessThanOrEqual(n)
    expect(a).toBeGreaterThan(n - 3)
  })

  test('skip while playing keeps playing from the new spot', async ({ page }) => {
    await openApp(page, ID)
    await page.locator('#play').click()
    await expect(page.locator('#page .w.on')).toHaveCount(1)
    await page.locator('#fwd5').click()
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'pause'))
    await expect.poll(() => activeIndex(page)).toBeGreaterThan(8)
  })

  test('elapsed / remaining time and the seek bar advance while reading (browser voice)', async ({ page }) => {
    await openApp(page, ID)
    test.skip(!(await page.locator('#tCur').count()), 'this build has no time display')
    await page.locator('#play').click()
    await page.waitForTimeout(3000)
    await expect(page.locator('#tCur'), 'elapsed time should move during playback').not.toHaveText('0:00')
    await expect(page.locator('#tLeft')).not.toHaveText('-0:00')
    await page.locator('#fwd5').click()
    await page.locator('#play').click()
    const at = await page.locator('#seek').inputValue()
    expect(Number(at), 'seek bar position').toBeGreaterThan(0)
    await page.locator('#back5').click()
    expect(Number(await page.locator('#seek').inputValue()), 'back 5 s moves the seek bar back').toBeLessThan(Number(at))
  })

  test('Start over resets the counter and highlight', async ({ page }) => {
    await openApp(page, ID)
    await page.locator('#fwd5').click()
    await page.locator('#restart').click()
    expect((await counter(page))[0]).toBe(0)
    await expect(page.locator('#page .w.on')).toHaveCount(0)
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'play'))
  })

  test('speed setting changes how fast the highlight moves', async ({ page }) => {
    async function wordsIn(ms, speed) {
      await openApp(page, ID)
      await page.locator('#speed').selectOption(speed)
      await page.locator('#play').click()
      await expect(page.locator('#page .w.on')).toHaveCount(1)
      const a = await activeIndex(page)
      await page.waitForTimeout(ms)
      const b = await activeIndex(page)
      await page.locator('#play').click()
      return b - a
    }
    await openApp(page, ID)
    const opts = await page.locator('#speed option').evaluateAll(o => o.map(x => x.value))
    const slow = await wordsIn(2500, opts[0])
    const fast = await wordsIn(2500, opts[opts.length - 1])
    expect(fast).toBeGreaterThan(slow)
  })

  test('voice button toggles mute state and label', async ({ page }) => {
    await openApp(page, ID)
    const v = page.locator('#voiceBtn')
    await expect(v).toHaveAttribute('aria-pressed', 'true')
    await expect(v).toHaveAttribute('aria-label', tr('en', 'voiceOn'))
    await v.click()
    await expect(v).toHaveAttribute('aria-pressed', 'false')
    await expect(v).toHaveAttribute('aria-label', tr('en', 'voiceOff'))
    // with voice off the highlight still runs on the timer, and nothing is spoken
    await page.evaluate(() => { window.__spoken.length = 0 })
    await page.locator('#play').click()
    await expect.poll(() => activeIndex(page), { timeout: 4000 }).toBeGreaterThanOrEqual(2)
    expect(await spoken(page)).toEqual([])
    await v.click()
    await expect(v).toHaveAttribute('aria-pressed', 'true')
  })

  test('Space plays and pauses; arrow keys skip', async ({ page }) => {
    await openApp(page, ID)
    await page.locator('#ptitle').click() // focus outside any control
    await page.keyboard.press('Space')
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'pause'))
    await page.keyboard.press('Space')
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'play'))
    await page.locator('#restart').click()
    await page.locator('#ptitle').click()
    await page.keyboard.press('ArrowRight')
    const [a] = await counter(page)
    expect(a).toBeGreaterThan(5)
    await page.keyboard.press('ArrowLeft')
    expect((await counter(page))[0]).toBe(0)
  })

  test('Space inside a text field does not toggle playback', async ({ page }) => {
    await openApp(page, '912')
    // the 9-12 "rejoice" stop has a textarea
    await page.locator('#page .w.stopw').nth(1).click()
    await page.locator('#stopBox textarea').fill('a b')
    await page.locator('#stopBox textarea').press('Space')
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'play'))
  })

  test('reading to the end stops and resets the position', async ({ page }) => {
    await openApp(page, 'k2')
    for (let i = 0; i < 60; i++) await page.locator('#fwd5').click()
    await page.locator('#back5').click()
    await page.locator('#play').click()
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'play'), { timeout: 15_000 })
    await expect(page.locator('#page .w.on')).toHaveCount(0)
    expect((await counter(page))[0]).toBe(0)
  })

  test('switching tab while playing stops playback', async ({ page }) => {
    await openApp(page, ID)
    await page.locator('#play').click()
    await expect(page.locator('#page .w.on')).toHaveCount(1)
    await page.locator('#tabs .tab[data-id="68"]').click()
    await expect(page.locator('#ptitle')).toHaveText(modeById('68').title)
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'play'))
    await page.waitForTimeout(800)
    await expect(page.locator('#page .w.on')).toHaveCount(0)
  })
})
