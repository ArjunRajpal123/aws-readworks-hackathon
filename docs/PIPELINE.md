*Draft concept for the ReadWorks x AWS hackathon team, Nov 3, 2026. Not a ReadWorks product. Content marked "machine-translated draft" has not been reviewed.*

# Sound Along: what the pipeline must build (handoff to engineering)

## 1. Ground rule

**No AI runs for the student.** All generation (translation, definitions, Word Stop questions, clue marking, audio) happens in the backend, ahead of time, and is stored. The browser only reads finished records and plays finished audio. This matches the tech brief: document-driven, audio and timing in S3, a frontend that does no processing beyond presentation.

Consequences:
- Everything the student sees or hears must exist as stored data before the passage is published. That includes Spanish, definitions, every question, every answer choice, every feedback line, and the audio for those lines.
- Anything AI-written is a draft until it passes automated checks, and (decision in section 8) a human approval.
- If the passage text changes, everything derived from it is regenerated and re-checked.

## 2. What the UI reads, and where it comes from

| UI feature | Record / field it reads | Built in stage |
|---|---|---|
| Passage text, word highlight, tap a word | `contentTokenized`, `tokenCount`, `structure` | P1 |
| Audio and live highlight | `tracks[]`, MP3, timing file (`start[]`, `end[]` per word, ms) | P3 |
| Sentence highlight, reading strip, fallback | `structure.sentenceStarts`, `paragraphStarts`; `granularity` | P1, P3 |
| Spanish passage | A second language version of the passage (own tokens, audio, timing) | P2 |
| Word card (definition, example, synonyms, part of speech, English equivalent, cognate flag, "watch for", word parts, shades of meaning) | `vocabCards[]` per sense per language | P4 |
| Dotted vocab words | `vocabAnchors[]` (occurrence to token index) | P1 |
| Word Stop (question, choices, right/wrong feedback, clue note) | `wordStops[]` | P5 |
| Highlighted clue words and the "Example clue" notes | `wordStops[].clues[]` (token groups: clue, opposite, signal) | P5 |
| Spoken question, choices, feedback, word pronunciation | Audio keys on each Word Stop and card | P6 |
| Picture choices (K-2) | Image assets with alt text | P5 |
| Passage details panel (grade, Lexile, author, type, vocabulary list) | Passage metadata, localized labels | P1 |
| Game features (jar, badges, streak, word bank) | No generated content. Computed in the browser from student actions | none |
| Interface text (buttons, hints, headings) | Shipped with the app, not the pipeline | none |

The student UI never chooses a grade-band look by itself: the teacher's assignment supplies the band, and each Word Stop lists the `bands` it applies to.

## 3. Build list

Each stage writes to the database/S3 and leaves a `generation` record (run id, model or tool and prompt version, time, input hash).

### P1. Ingest and tokenize (no AI)
- Read the passage JSON (`text`, `content`, `au`, vocab spans). Drop figures and captions.
- Whitespace tokens, numbered, wrapped in `<span data-w="i">`; keep vocab spans around the word span.
- Pinned tokenizer per language (`sa-tok-en-1.0`, `sa-tok-es-1.0`). Spanish keeps the inverted marks and accents attached to the word.
- Compute `textHash` of the token list. Same hash as the last run: stop, no cost.
- Map `data-vocab-occurrence-id` (English) and bold paired words (Spanish) to token indexes.

### P2. Language versions (AI, backend only)
- Where ReadWorks already has a Spanish paired text, use it (tagged `lang: "ES"`). Do not retranslate.
- Where it does not (the prototype assumed grades 3-12), generate a Spanish version and store it as a separate passage version with `provenance: machine`, `reviewStatus: draft`.
- Use a glossary so vocabulary words stay consistent across the passage, questions and cards.
- Each language version then goes through P1 and P3 on its own text. Do not reuse English timing.
- Gate: automated language check, length ratio check, vocab terms present, plus human review (section 6).

### P3. Audio and word timing
- Amazon Polly **neural**, English `Joanna`, Spanish `Lupe` (US Spanish; Mexican voices are an open question). Voice per language comes from config, never per passage.
- Async synthesis for text over about 3,000 characters (sync cap is 3,000 billed characters).
- Request speech marks with the same text, voice and engine as the audio. Offsets are **bytes** (UTF-8), not characters.
- Map marks to tokens by byte offset; token start = first mark inside it. End = next token's start; last end is estimated.
- Audio duration is not returned by Polly. Compute it from the MP3 frames, or store it from a probe.
- QA per track: every token mapped, times only increase, last start before audio end. On failure set `granularity: "sentence"` (UI falls back to sentence highlight).
- Pronunciation lexicons per language for names (Hunsford, Rosings). Not yet tested with neural voices.
- Human-recorded passages: keep the audio, add timing by forced alignment (WhisperX). Not prototyped.
- Retries, then a dead-letter queue and a daily failure report.

### P4. Vocabulary cards (AI for non-English, backend only)
ReadWorks data already gives, per sense: English definition, example, synonyms, Spanish translation of the word, and a pronunciation MP3. Build per language:
- Localized definition and example (Spanish: generated, `provenance: machine`, `reviewStatus: draft`).
- Part of speech label in the target language.
- English equivalent and cognate flag (Spanish cards).
- Optional by band: word parts (`formal + -idad`), "watch for" note (homophones, other senses), shades-of-meaning scale (9-12).
- Pronunciation audio for the word in the target language (P6).
- Gate: matches the ReadWorks sense; definition reading level suits the band.

### P5. Word Stops (AI, backend only)
One stop is a question attached to one vocab occurrence, for one band, in one language. Fields the UI needs:
- `type`: `picture_choice` (K-2), `multiple_choice`, `tap_clue` (6-8), `written` (9-12).
- `prompt`, `choices[]` with exactly one `correct`, `rightFeedback`, `wrongFeedback`, and a plain version of the right feedback (shown when game features are off).
- `clues[]`: type (definition, restatement, example, contrast, inference, word parts, look back), the **token ids** to highlight, the signal word if any, and a note shown after solving.
- `move` and `parts` (word-part stops), `bands[]`, `trigger: "tap"` only. Audio never pauses by itself.
- Picture choices need an image per choice (illustration source is an open decision), with alt text.
- Automated checks (a stop is shown only if all pass):
  1. Schema valid and written in the target language.
  2. Target is a tagged vocab occurrence; its token exists.
  3. Exactly one correct choice, and it agrees with the ReadWorks definition.
  4. Every clue token exists and lies in the allowed range for that clue type (for example the same or next sentence for a definition clue).
  5. The question does not contain the answer; distractors are not synonyms of the answer; choices are unique and similar in length.
  6. Reading level at or below the band; no unsafe or off-topic content.
  7. Spanish: no English fragments; accents and inverted marks intact.
- Clue token ids depend on the text. Store them with `textHash` and `tokenizerVersion`; when the hash changes, regenerate the stop.

### P6. Audio for everything the student hears besides the passage
The prototype currently uses the browser's built-in voice for these. They must be pre-generated with the same Polly voice:
- Word Stop prompt, each choice, right and wrong feedback.
- Word pronunciation on the card ("Hear it"). Reuse the ReadWorks MP3 for English if its quality is acceptable; Spanish needs generating.
- Store as small MP3s keyed by the hash of the text, so unchanged lines are never regenerated.

### P7. Assemble, version and publish
- Build one record per passage per language: the `soundAlong` block (see `03_JSON_Spec.md`) plus `vocabCards`, `wordStops`, asset keys.
- Publish atomically; keep the previous version; write `schemaVersion`, `generation`, review status.
- Only content with `reviewStatus: approved` (or `passed_checks`, if section 8 allows auto-publish) is included.
- Existing product JSON fields stay untouched; the sound block is added alongside (open question: inside the product JSON or as a sidecar file).

### P8. Review tooling
A queue for the content team showing, per passage and language: the AI draft beside the source, the automated check results, and approve / edit / reject with reviewer id and time. Machine translations should be sampled or fully reviewed (section 8).

### P9. Backfill and operations
- Run the catalog (6,893 passages, about 20M characters) through the same pipeline, safe to rerun, resumable.
- Cost report per run. Known list price: Polly neural speech and speech marks are each $16 per 1M characters. AI generation cost is not measured yet; measure on a 20-passage sample first.
- Metrics: runs, failures, QA fallbacks to sentence timing, items waiting for review.

## 4. Data the database holds

| Record | Key fields |
|---|---|
| Passage | id, source ids, grade, Lexile, type, author, title per language |
| PassageVersion | passageId, lang, `textHash`, tokenizerVersion, tokenCount, tokenized html, structure, provenance (`readworks` / `machine`), reviewStatus |
| Track | versionId, kind (`tts` / `human`), engine, voice, audio key, timing key, `granularity`, qa results, duration ms |
| VocabSense | senseId (ReadWorks), pos, English definition, example, synonyms |
| VocabCard | senseId, lang, definition, example, pos label, synonyms, cognate flag, word parts, watch-for, shades, English equivalent, audio key, provenance, reviewStatus |
| VocabAnchor | versionId, occurrenceId or paired-word source, senseId, tokenIndex |
| WordStop | versionId, occurrenceId, bands[], type, prompt, choices[], feedback texts, move, parts, clues[] (type, token ids, note), audio keys, image keys, checks[], status, proposedBy (model + prompt version), reviewer |
| Asset | key, kind (audio / image), text hash, alt text, license/source |
| GenerationRun | runId, trigger, stage, input hash, tool/model + prompt version, time, result |

## 5. Rules for AI generation (backend)

- Output must be structured JSON validated against a schema; reject and retry on failure. Never store free text that was not validated.
- Prompts and model ids are versioned and recorded on every record.
- The model is given only the passage text, the ReadWorks definition and sense, the band and the language. Nothing from students.
- Keep a glossary and examples in the prompt so Spanish terms are consistent.
- Low temperature; the same input hash must not silently produce a different published result. Regenerate only on hash change or an explicit request.
- Compare options on a small set before choosing: a general-purpose model on Bedrock versus Amazon Translate for passage translation (the second is a plain translation service and would still need the definition and question work done another way). This has not been tested.

## 6. Status model

`draft` -> `auto_checked` (passed / failed) -> `in_review` -> `approved` -> `published`. Any text change returns dependent items to `draft`. The UI shows only `published` content.

## 7. What exists already, and what the test showed

Reference only; the team builds the real thing.
- The prototype in `infra/` (CDK, Python 3.14 Lambda, S3 event trigger, Polly neural audio + marks, timing file, `soundAlong` block, DLQ) is deployed in the sandbox account. Treat it as a worked example of P1 and P3.
- 9 demo passages ran through it (4 English, 4 Spanish, 1 over 3,000 characters to exercise the async path). All 9 passed the token-mapping and timing-order checks.
- In 2 of the 9 (`35`, `long`), the number of Polly word marks differed from the whitespace token count, although every token still got a time. Cause not investigated.
- Spanish check: byte offsets start at 2 for text beginning with an inverted question mark, and Polly's sentence mark text drops that mark. Map by byte offset, not by string search.
- Not done: blind listening test of neural vs generative; pronunciation lexicons; human-audio alignment; Word Stop audio; any AI generation step; any review tooling.
- All Spanish passages, cards and Word Stops in the UI demo are **machine-translated drafts written by Claude**, not reviewed by ReadWorks or a Spanish editor.

## 8. Decisions needed

1. Spanish for grades 3-12: translate with AI, only where a paired text exists, or Spanish interface with the English passage? (UI currently assumes translation.)
2. Human approval before publish, or publish on automated checks alone? Is full review needed for machine translation, or a sample?
3. Where do picture-choice images come from (license, illustrate, generate), and who approves them?
4. `soundAlong` inside the product JSON, or a sidecar file?
5. US or Mexican Spanish voice?
6. How much highlight lag is acceptable?
7. Does ReadWorks want Spanish vocabulary definitions in its own data, or only generated ones?
8. Do names and acronyms get lexicons, and who maintains them?

## 9. Done means

- Give it a passage id; with no manual step it produces audio, timing, tokenized text, Spanish version, cards and stops, all stored and passing checks.
- The UI loads only those stored records and files; no call to any AI or TTS service from the browser.
- Re-running with unchanged text costs nothing; changing the text regenerates and re-checks everything that depends on it.
- A reviewer can see what is awaiting approval and what changed.
