// Automated WCAG 2.1 A/AA scan with axe-core for every passage and the main UI states.
import AxeBuilder from '@axe-core/playwright'
import { test, expect, openApp, PASSAGES } from './fixtures.js'

const meta = { tag: ['@axe'], annotation: [
  { type: 'area', description: 'Automated WCAG 2.1 AA scan (axe-core)' },
  { type: 'files', description: 'frontend/src/App.vue; frontend/src/style.css; frontend/src/engine.js (generated markup)' },
] }

async function scan(page, include) {
  const info = test.info()
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  if (include) b = b.include(include)
  const { violations } = await b.analyze()
  const out = violations.map(v => ({
    rule: v.id, impact: v.impact, help: v.help, url: v.helpUrl,
    nodes: v.nodes.slice(0, 5).map(n => n.target.join(' ')),
    count: v.nodes.length,
  }))
  // structured copy for scripts/make_tickets.mjs (one ticket per rule)
  if (out.length) await info.attach('axe-violations', { body: JSON.stringify(out), contentType: 'application/json' })
  return out
}

test.describe('axe accessibility scan', meta, () => {
  for (const m of PASSAGES) {
    for (const theme of ['light', 'dark']) {
      test(`${m.id} (${theme}) has no WCAG A/AA violations`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme })
        await openApp(page, m.id)
        const v = await scan(page)
        expect(v, JSON.stringify(v, null, 2)).toEqual([])
      })
    }
  }

  test('open accessibility panel has no violations', async ({ page }) => {
    await openApp(page, '35')
    await page.locator('#a11yBtn').click()
    const v = await scan(page, '#a11y')
    expect(v, JSON.stringify(v, null, 2)).toEqual([])
  })

  for (const id of ['k2', '35', '68', '912']) {
    test(`${id}: open Word Stop and game panel have no violations`, async ({ page }) => {
      await openApp(page, id)
      await page.locator('#gameBtn').click()
      await page.locator('#page .w.stopw').first().click()
      const v = await scan(page, '.side')
      expect(v, JSON.stringify(v, null, 2)).toEqual([])
    })
  }

  test('high contrast mode has no colour-contrast violations', async ({ page }) => {
    await openApp(page, '35')
    await page.locator('#a11yBtn').click()
    await page.locator('#a-contrast').check()
    const v = (await scan(page, '.main')).filter(x => x.rule === 'color-contrast')
    expect(v, JSON.stringify(v, null, 2)).toEqual([])
  })
})
