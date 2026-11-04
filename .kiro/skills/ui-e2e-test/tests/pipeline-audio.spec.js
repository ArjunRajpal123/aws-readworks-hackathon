// Passages and audio produced by the ETL pipeline, served from frontend/public/sa/.
// Uses the committed-locally e1p1 sample when present, plus synthetic fixtures served
// through page.route so the suite does not depend on real pipeline output.
import { test, expect, openApp, activeIndex, counter, tr, MODES } from './fixtures.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const meta = { tag: ['@pipeline'], annotation: [
  { type: 'area', description: 'ETL product loading and Amazon Polly audio playback (product JSON, gzipped timing, MP3)' },
  { type: 'files', description: 'frontend/src/engine.js (loadProduct, parseETL, renderETL, loadETL, loadAudio, readAudio, showSource); docs/PIPELINE.md' },
] }

const here = path.dirname(fileURLToPath(import.meta.url))
const SA = path.resolve(here, '../../../../frontend/public/sa')
const hasE1 = fs.existsSync(path.join(SA, 'product/e1p1.soundAlong.json'))

/** Build a minimal product + timing for a fake passage and route it. */
async function routeFake(page, { id = 'fake1', words = ['One', 'two', 'three.', 'Four', 'five.'], qa = 'passed', hashMatch = true, mp3 = true } = {}) {
  const contentTokenized = '<p>' + words.map((w, i) => `<span data-w="${i}">${w}</span>`).join(' ') + '</p>'
  const prod = {
    schemaVersion: 3, id, lang: 'en', title: `Fake passage ${id}`, textHash: 'sha256:abc', tokenCount: words.length,
    contentTokenized, structure: { paragraphStarts: [0], sentenceStarts: [0, 3] }, details: '<div>Source: test</div>',
    tracks: [{ voiceId: 'Joanna', audioKey: `audio/${id}/tts-1.mp3`, timingKey: `audio/${id}/tts-1.timing.json`, qa: { status: qa } }],
  }
  const timing = { textHash: hashMatch ? 'sha256:abc' : 'sha256:zzz', n: words.length,
    start: words.map((_, i) => i * 150), end: words.map((_, i) => i * 150 + 140) }
  await page.route(`**/sa/product/${id}.soundAlong.json`, r => r.fulfill({ json: prod }))
  await page.route(`**/sa/audio/${id}/tts-1.timing.json`, r => r.fulfill({ json: timing }))
  if (mp3 && hasE1) await page.route(`**/sa/audio/${id}/tts-1.mp3`, r => r.fulfill({ path: path.join(SA, 'audio/e1p1/tts-1.mp3'), contentType: 'audio/mpeg' }))
  return prod
}

test.describe('Pipeline passages and Polly audio', meta, () => {
  test('e1p1 sample: renders product text and reports Polly as the voice', async ({ page }) => {
    test.skip(!hasE1, 'frontend/public/sa/product/e1p1.soundAlong.json not present (git-ignored pipeline output)')
    const prod = JSON.parse(fs.readFileSync(path.join(SA, 'product/e1p1.soundAlong.json'), 'utf8'))
    await openApp(page, 'e1p1')
    await expect(page.locator('#ptitle')).toHaveText(prod.title)
    await expect(page.locator('#page .w')).toHaveCount(prod.tokenCount)
    // the tag may be prefixed with a note when the preferred voice has no track for this passage
    await expect(page.locator('#srcTag')).toContainText(tr('en', 'srcPolly', prod.tracks[0].voiceId))
    await expect(page.locator('#stopBox')).toHaveText(tr('en', 'etlIdle'))
    await expect(page.locator('#tabs .tab[aria-selected="true"]')).toHaveCount(0)
    await expect(page.locator('#rewardWrap')).toBeHidden()
  })

  test('e1p1 sample: play drives the highlight from the audio clock', async ({ page }) => {
    test.skip(!hasE1, 'pipeline sample not present')
    await openApp(page, 'e1p1')
    await expect(page.locator('#srcTag')).toContainText('Polly')
    await page.locator('#play').click()
    await expect.poll(() => activeIndex(page), { timeout: 8000 }).toBeGreaterThanOrEqual(3)
    await page.locator('#play').click()
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'play'))
  })

  test('e1p1 sample: tapping a word plays from that word', async ({ page }) => {
    test.skip(!hasE1, 'pipeline sample not present')
    await openApp(page, 'e1p1')
    await expect(page.locator('#srcTag')).toContainText('Polly')
    await page.locator('#page .w').nth(30).click()
    await expect.poll(() => activeIndex(page), { timeout: 8000 }).toBeGreaterThanOrEqual(30)
  })

  test('synthetic product renders and counts words', async ({ page }) => {
    const prod = await routeFake(page)
    await openApp(page, prod.id)
    await expect(page.locator('#ptitle')).toHaveText(prod.title)
    await expect(page.locator('#page .w')).toHaveCount(prod.tokenCount)
    await expect(page.locator('#time')).toHaveText(`0 / ${prod.tokenCount} words`)
    await expect(page.locator('#details')).toContainText('Source: test')
  })

  for (const withDuration of [true, false]) {
    test(`Polly track ${withDuration ? 'with' : 'without'} durationMs: time display and seek bar follow the audio`, async ({ page }) => {
      test.skip(!hasE1, 'needs the sample MP3 under frontend/public/sa/')
      const words = Array.from({ length: 67 }, (_, i) => `w${i}`)
      const prod = await routeFake(page, { id: withDuration ? 'fakedur' : 'fakenodur', words })
      if (withDuration) await page.route('**/sa/audio/fakedur/tts-1.timing.json', r => r.fulfill({ json: {
        textHash: 'sha256:abc', n: words.length, durationMs: words.length * 150,
        start: words.map((_, i) => i * 150), end: words.map((_, i) => i * 150 + 140) } }))
      await openApp(page, prod.id)
      await expect(page.locator('#srcTag')).toContainText('Polly')
      test.skip(!(await page.locator('#tCur').count()), 'this build has no time display')
      await expect(page.locator('#seek'), 'seek bar is usable once audio is loaded').toBeEnabled()
      await expect(page.locator('#tLeft')).not.toHaveText('-0:00')
      await page.locator('#play').click()
      await page.waitForTimeout(2500)
      await expect(page.locator('#tCur')).not.toHaveText('0:00')
    })
  }

  test('deployed: every passage that names a Polly audio id has a product file on the server', async ({ request, baseURL }) => {
    test.skip(!process.env.SA_UI_URL, 'only meaningful against a deployed site (SA_UI_URL)')
    const ids = [...new Set(MODES.filter(m => m.audio).map(m => m.audio))]
    const missing = []
    for (const id of ids) {
      const r = await request.get(new URL(`sa/product/${id}.soundAlong.json`, baseURL).href)
      const ok = r.ok() && (r.headers()['content-type'] || '').includes('json')
      if (!ok) missing.push(id)
    }
    expect(missing, `${missing.length} of ${ids.length} audio ids have no sa/product/<id>.soundAlong.json, so those passages fall back to the browser voice`).toEqual([])
  })

  test('QA status not "passed": falls back to the browser voice', async ({ page }) => {
    const prod = await routeFake(page, { id: 'fakeqa', qa: 'failed' })
    await openApp(page, prod.id)
    await page.waitForTimeout(500)
    await expect(page.locator('#srcTag')).toHaveText(tr('en', 'srcBrowser'))
  })

  test('timing textHash mismatch: falls back to the browser voice', async ({ page }) => {
    const prod = await routeFake(page, { id: 'fakehash', hashMatch: false })
    await openApp(page, prod.id)
    await page.waitForTimeout(500)
    await expect(page.locator('#srcTag')).toHaveText(tr('en', 'srcBrowser'))
  })

  test('missing product file for an unknown id falls back to K-2 without errors', async ({ page }) => {
    await openApp(page, 'nope404')
    await expect(page.locator('body')).toHaveClass(/\bb-k2\b/)
  })

  test('controls are safe to use while a pipeline passage is still loading', async ({ page }) => {
    // Hold the product fetch so the first load is still pending when the user acts.
    await page.route('**/sa/product/slowid.soundAlong.json', async r => {
      await new Promise(s => setTimeout(s, 1500)); await r.fulfill({ status: 404, body: '' })
    })
    await page.goto('./?m=slowid')
    await page.setViewportSize({ width: 700, height: 600 }) // resize handler
    await page.keyboard.press('ArrowRight')                 // skip handler
    await page.locator('#play').click()                     // play handler
    await expect(page.locator('#ptitle')).toHaveText("Let's Meet a Park Caretaker", { timeout: 5000 })
    // fixture fails the test if any of the above threw a page error
  })

  test('switching from a pipeline passage to a demo tab and back works', async ({ page }) => {
    const prod = await routeFake(page, { id: 'fakeswitch' })
    await openApp(page, prod.id)
    await page.locator('#tabs .tab[data-id="35"]').click()
    await expect(page.locator('#page .w.stopw')).toHaveCount(2)
    await openApp(page, prod.id)
    await expect(page.locator('#ptitle')).toHaveText(prod.title)
    await expect(page.locator('#page .w.stopw')).toHaveCount(0)
  })

  test('skip buttons work on a pipeline passage', async ({ page }) => {
    const prod = await routeFake(page, { id: 'fakeskip', words: Array.from({ length: 60 }, (_, i) => `w${i}`) })
    await openApp(page, prod.id)
    await page.locator('#fwd5').click()
    expect((await counter(page))[0]).toBeGreaterThan(0)
  })
})
