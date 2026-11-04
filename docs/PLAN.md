*Draft concept for the ReadWorks x AWS hackathon team, Nov 3, 2026. Not a ReadWorks product.*

# UI plan: Polly wiring and full Spanish

## Where the UI is today
- Look matches WordStops_v8 (src/style.css, App.vue).
- Behavior is still the demo: browser voice, estimated timing, demo passages in `src/data.js`, one imperative `src/engine.js`.
- Spanish exists only as one K-2 passage (`k2es`). Every other label, hint, question and button is English text written into the code.

## A. Wire the sound to Polly

| Step | What | Done when |
|---|---|---|
| A1 | Confirm Polly neural + speech marks work in the sandbox account (us-west-2). Not yet verified. | One `StartSpeechSynthesisTask` returns MP3 and marks |
| A2 | Script: 3 EN + 2 ES passages through Polly (audio + word/sentence marks), same text, voice and engine for both. Map marks to word numbers using UTF-8 byte offsets (accents, curly quotes). Write `tts-1.mp3` and `tts-1.timing.json` per the spec | Mark count equals word count; times only rise |
| A3 | Data layer: replace `data.js` passages with a loader that reads the `soundAlong` block + timing file (`contentTokenized`, `structure`, `tracks`, `vocabAnchors`, `wordStops`). Check `textHash` against the timing file | Demo passages load from JSON |
| A4 | Clock: drive highlighting from `<audio>.currentTime` (binary search over start times), not timers or speechSynthesis boundaries. Seek, back/forward 5 s, `playbackRate` for speed | Highlight stays within a small tolerance of the audio |
| A5 | Fallback: if a track's `granularity` is `sentence`, highlight by sentence from `structure.sentenceStarts` | Forced test passes |
| A6 | Read-aloud for Word Stop questions, answers, feedback and the card's "Hear it": pre-generate with Polly in the pipeline (not browser voice) | No browser TTS left |
| A7 | Blind A/B listen: neural vs generative vs current voice | Decision recorded |
| A8 | Later: S3-event Lambda pipeline (CDK) produces the same files automatically | Backfill batch runs |

Notes: Polly marks give start times only (end = next word's start). Sync synthesis caps at 3,000 billed characters, so use the async task. Audio and marks must use the same voice.

## B. Spanish across the whole platform

Two different things need to switch:

1. **Platform language (all interface text).** Add an i18n layer: one `en` and one `es` dictionary, no text inside the engine. Covers top bar, buttons, tabs and subtitles, legend, stop headers, hints, right/wrong feedback, word card labels, details labels, reward panels, accessibility panel, keyboard help, footer. Also sets `<html lang>`, speech language and the Polly voice.
2. **Passage and Word Stop content.** Each grade band needs a Spanish version of: passage, vocab cards, Word Stops (question, choices, feedback, clue notes).

One global language switch (not per tab). The choice persists across tabs and sessions.

Spanish data:
- Use Spanish voices (US: Lupe, Pedro; Mexico: Mia, Andres; decision open).
- Tokenizer keeps the inverted marks and accents attached to their word.
- Vocab definitions: ReadWorks has none in Spanish yet (open question). Short term: show the paired English definition, as the K-2 demo does.

## C. Design fixes
Waiting on your list (see questions).

## Order of work
1. A1, A2 (prove Polly timing end to end)
2. B1 i18n layer (mechanical, unblocks everything)
3. A3 to A5 (real data and audio clock)
4. B2 Spanish content for each band
5. A6, design fixes
6. A7, A8

## Open questions
- Spanish passages for grades 3-12: ReadWorks has Spanish only for paired texts (5th grade and below). Options: (a) Spanish interface with the English passage where no Spanish passage exists; (b) machine-translated Spanish passages, which need ReadWorks approval and review; (c) Spanish only where a paired text exists. Which?
- Which design elements are not working well?
- US Spanish or Mexican Spanish voice?
