// Every tappable vocabulary word in every passage opens the right word card.
import { test, expect, openApp, PASSAGES, MODES, CARDS, bandOf, uiLangOf, tr, spoken } from './fixtures.js'

const meta = { tag: ['@cards'], annotation: [
  { type: 'area', description: 'Vocabulary word cards: open on tap/keyboard, card contents per band, Hear it' },
  { type: 'files', description: 'frontend/src/engine.js (showCard, keyFor, page click/keydown handlers); frontend/src/data.js (CARDS); frontend/src/data_es.js' },
] }

const cardsFor = word => Object.entries(CARDS).filter(([, c]) => c.word === word)

test.describe('Word cards', meta, () => {
  for (const m of PASSAGES) {
    const lang = uiLangOf(m), band = bandOf(m)
    test(`${m.id}: every vocabulary word opens its card with the right content`, async ({ page }) => {
      await openApp(page, m.id)
      await page.locator('#stopsBtn').click() // stops off so dotted words open cards directly
      const vocab = page.locator('#page .w.vocab')
      const n = await vocab.count()
      // passages whose source text marks vocabulary with * must render it as tappable words
      const marked = m.paras.join(' ').split(/\s+/).filter(w => /^([~\-=]\d)*\*/.test(w)).length
      expect(n, 'tappable vocabulary words match the * markers in the passage text').toBe(marked)
      for (let i = 0; i < n; i++) {
        const el = vocab.nth(i)
        await expect(el).toHaveAttribute('role', 'button')
        await expect(el).toHaveAttribute('tabindex', '0')
        const label = await el.getAttribute('aria-label')
        expect(label.startsWith(tr(lang, 'openCard'))).toBe(true)
        const word = label.slice(tr(lang, 'openCard').length)
        const candidates = cardsFor(word)
        expect(candidates.length, `CARDS has an entry for "${word}"`).toBeGreaterThan(0)
        await el.click()
        const card = page.locator('#cardBody .card')
        await expect(card.locator('.word')).toContainText(word)
        const body = await card.innerText()
        const c = candidates.map(([, c]) => c).find(c => body.includes(c.def.slice(0, 40))) || candidates[0][1]
        expect(body, `definition for "${word}"`).toContain(c.def.slice(0, 40))
        await expect(card.locator('.pos')).toHaveText(c.pos)
        for (const syn of c.syn) await expect(card.locator('.chip', { hasText: syn }).first()).toBeVisible()
        for (const es of c.es || []) await expect(card.locator('.chip', { hasText: es }).first()).toBeVisible()
        if (band === '912' && c.shades) await expect(card.locator('.shades .scale .me')).toHaveText(c.shades.words[c.shades.me])
        if ((band === '912' || band === '68') && c.parts) await expect(card).toContainText(c.parts)
        if (!(band === '912' || band === '68')) await expect(card.locator('.shades')).toHaveCount(0)
        if (c.pair) await expect(card).toContainText(c.pair)
        // card reads the word aloud when opened
        await expect.poll(() => spoken(page)).toContain(c.word)
      }
    })
  }

  test('Hear it reads the word again', async ({ page }) => {
    await openApp(page, '912')
    await page.locator('#stopsBtn').click() // "discernible" is a stop word; with stops off it opens the card
    await page.locator('#page .w.vocab').first().click()
    await page.evaluate(() => { window.__spoken.length = 0 })
    await page.locator('#hear').click()
    await expect.poll(() => spoken(page)).toEqual(['discernible'])
  })

  test('keyboard: Tab to a vocabulary word and press Enter opens its card', async ({ page }) => {
    await openApp(page, '35')
    await page.locator('#stopsBtn').click()
    const first = page.locator('#page .w.vocab').first()
    await first.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#cardBody .word')).toContainText('tax')
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'play')) // Enter does not start playback
  })

  test('tapping a vocabulary word while reading pauses playback', async ({ page }) => {
    await openApp(page, '35')
    await page.locator('#stopsBtn').click()
    await page.locator('#play').click()
    await expect(page.locator('#page .w.on')).toHaveCount(1)
    await page.locator('#page .w.vocab').first().click()
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'play'))
    await expect(page.locator('#cardBody .card')).toBeVisible()
  })
})
