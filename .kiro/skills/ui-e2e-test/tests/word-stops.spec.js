// Every Word Stop in every passage (English and Spanish), driven from frontend/src/data*.js.
import { test, expect, openApp, PASSAGES, MODES, CARDS, bandOf, uiLangOf, tr, spoken, activeIndex } from './fixtures.js'

const meta = { tag: ['@stops'], annotation: [
  { type: 'area', description: 'Word Stops: questions, answer feedback, clue reveal, tap-the-clue, written reply' },
  { type: 'files', description: 'frontend/src/engine.js (openStop, choiceButtons, reveal, stopHeader, stepper, stopWordIdx); frontend/src/data.js; frontend/src/data_es.js; frontend/src/i18n.js' },
] }

/** Number of passage tokens whose clue group is g (same marker grammar as engine.parse). */
function groupCount(m, g) {
  let n = 0
  for (const raw of m.paras.join(' ').split(/\s+/)) {
    let t = raw.replace(/\^$/, ''), grp = null, mm
    while ((mm = t.match(/^([~\-=])(\d)/)) || (t[0] === '*' && t.length > 1)) {
      if (mm) { grp = +mm[2]; t = t.slice(2) } else t = t.slice(1)
    }
    if (grp === g) n++
  }
  return n
}

async function answer(page, m, k) {
  const s = m.stops[k], lang = uiLangOf(m), box = page.locator('#stopBox')
  if (s.type === 'tapclue') {
    const check = box.getByRole('button', { name: tr(lang, 'checkClue') })
    await check.click()
    await expect(box.locator('.err')).toHaveText(tr(lang, 'tapOne'))
    // a word that is not a clue
    await page.locator('#page .w:not(.clue):not(.vocab):not(.signal)').first().click()
    await check.click()
    await expect(box.locator('.err')).toHaveText(tr(lang, 'tapErr'))
    await page.locator('#page .w.picked').click() // tap again to unselect
    await expect(page.locator('#page .w.picked')).toHaveCount(0)
    const clues = page.locator('#page .w.clue')
    for (let i = 0; i < await clues.count(); i++) await clues.nth(i).click()
    await check.click()
    await expect(box.locator('.fb.ok').first()).toContainText(tr(lang, 'niceFind', '').replace(/[“”".]/g, '').trim())
    await expect(page.locator('#page')).not.toHaveClass(/tapping/)
    await expect(page.locator('#page .w.picked')).toHaveCount(0)
    await expect(box.locator('p.q').last()).toHaveText(s.q2)
  }
  if (s.type === 'write') {
    const ta = box.locator('textarea')
    await expect(ta).toHaveAttribute('placeholder', tr(lang, 'replyPh'))
    await ta.fill('too short')
    await box.getByRole('button', { name: tr(lang, 'replyBtn') }).click()
    await expect(box.locator('.err')).toHaveText(tr(lang, 'replyErr'))
    await ta.fill('they are celebrating and very happy')
    await expect(box.locator('.err')).toHaveText('')
    await box.getByRole('button', { name: tr(lang, 'replyBtn') }).click()
    await expect(ta).toHaveJSProperty('readOnly', true)
    await expect(box.locator('.av.you')).toHaveText(tr(lang, 'you'))
    await expect(box.locator('.hint').last()).toHaveText(tr(lang, 'compareHint'))
    return
  }
  // choice / pictures (and the second half of tapclue)
  const choices = box.locator('.choice')
  await expect(choices).toHaveCount(s.choices.length)
  for (const [i, c] of s.choices.entries()) await expect(choices.nth(i)).toContainText(c.t)
  const wrong = s.choices.findIndex(c => !c.ok)
  await choices.nth(wrong).click()
  await expect(choices.nth(wrong)).toHaveClass(/\bwrong\b/)
  await expect(box.locator('.fb').last()).toHaveClass(/\bno\b/)
  await expect(box.locator('.fb').last()).toHaveText(s.wrong)
  const right = s.choices.findIndex(c => c.ok)
  await choices.nth(right).click()
  await expect(choices.nth(right)).toHaveClass(/\bright\b/)
  await expect(box.locator('.fb').last()).toHaveText(s.rightPlain || s.right)
  // answered: further clicks change nothing
  await choices.nth(wrong).click()
  await expect(box.locator('.fb').last()).toHaveText(s.rightPlain || s.right)
}

async function checkRevealed(page, m, k) {
  const s = m.stops[k], lang = uiLangOf(m), box = page.locator('#stopBox')
  const anchor = page.locator('#page .w.stopw').nth(k)
  await expect(anchor).toHaveClass(/\bsolved\b/)
  await expect(page.locator('#cardBody .word')).toContainText(CARDS[s.word].word)
  if (s.clue) await expect(page.locator('#cardBody .ct')).toHaveText(s.clue)
  for (const n of s.notes) await expect(page.locator(`#notes${n.p} .callout .k`, { hasText: n.k })).toHaveCount(1)
  await expect(page.locator('#page .w.lit')).toHaveCount(groupCount(m, k + 1))
  await expect(box.locator('.stepper i').nth(k)).toHaveClass(/\bok\b/)
  if (bandOf(m) === '68' && s.parts) await expect(box.locator('.blocks .res')).toHaveText(s.parts[2])
  if (bandOf(m) === '912') await expect(box.locator('.resolved')).toHaveText(tr(lang, 'resolved'))
  await expect(box.getByRole('button', { name: tr(lang, 'fromStart') })).toBeVisible()
}

test.describe('Word Stops', meta, () => {
  for (const m of PASSAGES) {
    const lang = uiLangOf(m)
    test(`${m.id}: one dotted word per stop, details count matches`, async ({ page }) => {
      await openApp(page, m.id)
      await expect(page.locator('#page .w.stopw')).toHaveCount(m.stops.length)
      if (m.stops.length) await expect(page.locator('#details')).toContainText(`${m.stops.length}`)
      else await expect(page.locator('#stopBox')).toHaveText(tr(lang, 'idleNone'))
    })

    m.stops.forEach((s, k) => {
      test(`${m.id} stop ${k + 1} "${s.word}" (${s.type}): wrong answer, right answer, reveal`, async ({ page }) => {
        await openApp(page, m.id)
        await page.locator('#page .w.stopw').nth(k).click()
        const box = page.locator('#stopBox')
        await expect(box).not.toHaveClass(/idle/)
        await expect(page.locator('#page')).toHaveClass(/stopping/)
        await expect(box.locator('.stepper')).toContainText(String(k + 1))
        await expect(box.locator('.stepper i').nth(k)).toHaveClass(/\bcur\b/)
        await expect(box).toContainText(s.q)
        if (bandOf(m) === '68') await expect(box.locator('.tag68')).toContainText(s.move)
        if (bandOf(m) === '912') {
          await expect(box.locator('.who')).toHaveText(tr(lang, 'wsName'))
          await expect(page.locator('#page .w.stopw').nth(k)).toHaveClass(/active-anchor/)
        }
        if (s.type === 'pictures') {
          await expect(box.locator('.choice.pic svg')).toHaveCount(s.choices.length)
          await expect.poll(() => spoken(page)).toContain(s.say)
        }
        if (s.type === 'tapclue') await expect(page.locator('#page')).toHaveClass(/tapping/)
        await answer(page, m, k)
        await checkRevealed(page, m, k)
        // a solved stop now opens the word card instead of the question again
        await page.locator('#page .w.stopw').nth(k).click()
        await expect(page.locator('#cardBody .word')).toContainText(CARDS[s.word].word)
        await expect(box.locator('.stepper i').nth(k)).toHaveClass(/\bok\b/)
      })
    })
  }

  test('opening a stop while reading pauses, and the stop offers "Resume reading"', async ({ page }) => {
    await openApp(page, '35')
    await page.locator('#play').click()
    await expect.poll(() => activeIndex(page), { timeout: 4000 }).toBeGreaterThanOrEqual(2)
    await page.locator('#page .w.stopw').first().click()
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'play'))
    await expect(page.locator('#page .w.on')).toHaveCount(0)
    const s = MODES.find(x => x.id === '35').stops[0]
    await page.locator('#stopBox .choice', { hasText: s.choices.find(c => c.ok).t }).click()
    const resume = page.locator('#stopBox').getByRole('button', { name: tr('en', 'resume') })
    await expect(resume).toBeVisible()
    await resume.click()
    await expect(page.locator('#play')).toHaveAttribute('aria-label', tr('en', 'pause'))
    expect(await activeIndex(page)).toBeGreaterThanOrEqual(2)
  })

  test('Word Stops off: no dotted words, tapping a stop word opens its card only', async ({ page }) => {
    await openApp(page, '35')
    const btn = page.locator('#stopsBtn')
    await btn.click()
    await expect(btn).toHaveText(tr('en', 'stopsBtn', false))
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('#page .w.stopw')).toHaveCount(0)
    await expect(page.locator('#stopBox')).toHaveText(tr('en', 'stopsOff'))
    await page.locator('#page .w.vocab', { hasText: 'Taxes' }).click()
    await expect(page.locator('#cardBody .word')).toContainText('tax')
    await expect(page.locator('#stopBox')).toHaveClass(/idle/)
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#page .w.stopw')).toHaveCount(2)
  })

  test('Read questions aloud: opening a stop speaks the question and choices', async ({ page }) => {
    await openApp(page, '35')
    await page.locator('#a11yBtn').click()
    await page.locator('#a-readq').check()
    await page.locator('#page .w.stopw').first().click()
    const s = MODES.find(x => x.id === '35').stops[0]
    await expect.poll(async () => (await spoken(page)).join('|')).toContain(s.q)
    expect((await spoken(page)).join('|')).toContain(s.choices[0].t)
  })

  test('answers are spoken as feedback', async ({ page }) => {
    await openApp(page, '35')
    const s = MODES.find(x => x.id === '35').stops[0]
    await page.locator('#page .w.stopw').first().click()
    await page.locator('#stopBox .choice', { hasText: s.choices.find(c => !c.ok).t }).click()
    await expect.poll(() => spoken(page)).toContain(s.wrong)
  })
})
