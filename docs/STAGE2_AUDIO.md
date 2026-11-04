*Stage 2 (P3: audio and word timing) notes for the ReadWorks x AWS hackathon team, Nov 3, 2026. Builds on the ETL in `etl/`; see `docs/PIPELINE.md` for the full pipeline.*

# Stage 2: natural-sounding Polly Neural audio and word timing

## Decisions
- **Engine:** Amazon Polly **Neural** with word speech marks for timing. Generative stays a future option: generative voices return no speech marks, so they'd need forced alignment.
- **Voices:** **Ruth** (en-US) and **Lupe** (es-US), both women's voices. There's one voice per language and none chosen per passage. Letting people choose a voice is a future release.
- **Make Neural sound as human as it can.** Neural has no emphasis, pitch control, breaths or whispering. It does respond to structure, punctuation, pauses, pace and pronunciation, so every passage is sent as SSML.

## What Polly receives (`etl/ssml.py`, settings in `etl/voices.json`)

```xml
<speak><amazon:effect name="drc"><prosody rate="95%">
  <p><s>First sentence.</s><s>Second sentence?</s></p>
  <p><s>…</s></p>
</prosody></amazon:effect></speak>
```

| Setting | Effect for students | Default |
|---|---|---|
| `<p>` / `<s>` from the tokenizer's paragraph and sentence starts | Natural pauses, and end-of-sentence intonation in the right places | on |
| No `<s>` break after `Mr.`, `Mrs.`, `Ms.`, `Dr.`, `Sr.`, `Sra.`, `EE.` … or before a lowercase word | No mid-sentence pause after titles or after `U.S.` (the shared tokenizer splits there). Only affects audio; `structure.sentenceStarts` is unchanged | on |
| Punctuation kept on tokens | Question and exclamation intonation, comma pauses | always |
| `rate` | A slightly unhurried read-along pace; the player's speed control still applies | `95%` |
| `drc` (dynamic range compression) | Even loudness on Chromebook and tablet speakers | on |
| `paragraphBreakMs` | Optional extra pause between paragraphs | `0` |
| Lexicons `lexicons/en-US.pls`, `es-US.pls` (Polly names `saEnUS`, `saEsUS`) | Names and abbreviations said the same way every time | on |
| `inlineLexicon` | Fallback if Neural ignores `LexiconNames`: apply the same entries inline as `<sub>` / `<phoneme>` | off |
| Per-passage `pronunciation` in the input JSON, `{"<tokenIndex>": {"w": "amazon:VB"}}` (also `sub`, `phoneme`, `lang`, `sayAs`) | One-off fixes: "live" (verb), `½`, English names in Spanish text | none |
| `"ssml": false` | Back to the original plain-text request | — |

`configVersion` on the track records every setting that changes the audio, for example `en-US/neural/Ruth/ssml/lex-1/r95%/drc1/pb0`.

## Timing (unchanged approach, one fix)
- Polly's word-mark offsets are **UTF-8 bytes into the exact input, SSML tags included** (verified with Ruth). `ssml.py` records each token's byte span while building the SSML, and `audio.build_timing(..., token_spans=...)` maps marks onto tokens by those spans. Without SSML it falls back to the original text search.
- Sentence marks are requested in the same call (no extra cost) and ignored by the word mapping. `qa.pollySentences` should equal `qa.ssmlSentences`.
- **Why mark counts can differ from token counts** (`PIPELINE.md` §7): Polly sometimes gives one mark to two words. Lupe gave "el patio" a single mark, so "patio" gets an interpolated time and is listed in `qa.lowConfidence`.

## Additions to the product record (all additive; the player is unchanged)
- `tracks[0]`: `configVersion`, `settings` (textType, rate, drc, paragraphBreakMs, sampleRate, lexiconMode, pronunciationOverrides), and in `qa`: `sentences`, `pollySentences`, `ssmlSentences`, `mergedSentenceBreaks`. `qa.marks` is now the real word-mark count.
- `generation`: `configVersion`, `billedChars`, `estCostUsd` (Neural $16 per 1M characters; speech marks billed separately at the same rate).
- Timing file: adds `v`, `trackId`, `durationMs` (team schema v3 `timingFile`).

## First run (Nov 3, 2026, sandbox)
18 sample inputs (9 EN with Ruth, 9 ES with Lupe; grade 4 edge cases: numbers, `½`, ordinals, `Mr./Sr.`, `U.S./EE. UU.`, dates):
- **18/18 `qa.status: passed`.** Polly's sentence count matched the intended sentences in all 18.
- Title and abbreviation breaks were merged in 6 passages.
- 1 word estimated (the "el patio" case).
- About $0.20 in total.

The Vue player loaded them as "Amazon Polly neural (Ruth)" with live highlighting.

## Next (Stage 2 roadmap)
1. **Evals:** contract and tie-out checks, Amazon Transcribe word-accuracy and timing agreement, a blind Neural vs. Standard listening pack, and ReadWorks traceability.
2. **Robustness:**
   - skip passages whose `textHash` and `configVersion` are unchanged
   - versioned audio folders, so a failed run never overwrites live audio
   - async synthesis for text over 3,000 characters
3. **Deploy** (with the team): S3/EventBridge trigger, retries and a DLQ, writing to the existing `StorageStack` bucket and reference table.

## Open points for the team
- The shared tokenizer ends a sentence after `Mr.` / `U.S.`. Stage 2 works around it for audio only, but `structure.sentenceStarts` (sentence highlight) still splits there. Suggest the same abbreviation rule in `tokenizer.py`.
- The QA fallback value: etl writes `"sentence"`, schema v3 says `"fallback_sentence"`. The player only checks for `"passed"`.
- Lexicon entries are starting guesses (DeSean, Scottadino, `EE.` `UU.`, `Sr.`) to check by ear.
