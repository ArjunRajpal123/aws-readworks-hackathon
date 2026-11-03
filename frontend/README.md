# Sound Along UI

*Draft concept for the ReadWorks x AWS hackathon team. Not a ReadWorks product.*

Browser front end for Sound Along: read-along highlighting, tap-to-replay, Word Stops, word cards, four grade-band looks (K-2, 3-5, 6-8, 9-12), English and Spanish, accessibility options, and light/dark mode.

Vue 3 + Vite. No other runtime libraries.

## Run

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # output in dist/
```

Open a specific passage with `?m=` and an id: `k2`, `35`, `68`, `912` (English) or `k2es`, `35es`, `68es`, `912es` (Spanish), for example `http://127.0.0.1:5173/?m=912es`.

## Where things are

| File | What it is |
|---|---|
| `src/App.vue` | Page markup (teal bar, title band, tabs, player, sidebar, accessibility panel, footer) |
| `src/style.css` | All styles, including the four grade-band looks and the dark theme (tokens at the top) |
| `src/engine.js` | Player and Word Stop logic: playback, highlight, tap to replay, stops, cards, accessibility, theme, language |
| `src/data.js` | Demo passages, vocabulary cards and Word Stops (English and the K-2 Spanish passage) |
| `src/data_es.js` | Spanish passages, cards and Word Stops for 3-12 (**machine-translated drafts, not reviewed**) |
| `src/i18n.js` | Interface text, English and Spanish (Spanish is a machine-translated draft) |
| `docs/PIPELINE.md` | What the backend pipeline must produce for this UI (handoff to engineering) |
| `docs/PLAN.md` | UI plan: Polly wiring and full Spanish |

## Audio

With no audio files the player uses the browser's built-in voice with estimated word timing, and says so under the legend.

To use Amazon Polly audio, put the pipeline output under `public/sa/` (git-ignored) in this layout, where `<id>` is the passage id:

```
public/sa/product/<id>.soundAlong.json
public/sa/audio/<id>/tts-1.mp3
public/sa/audio/<id>/tts-1.timing.json.gz
```

The player loads these when present and the passage's `qa.status` is `passed`, then drives the highlight from the audio clock. The field definitions are in `docs/PIPELINE.md` and the pack's `03_JSON_Spec.md`.

## Known limits

- Passages, cards and Word Stops are still hard-coded demo content in `src/data*.js`; the real build reads them from the pipeline's stored records.
- Spoken Word Stop questions and feedback still use the browser voice; the pipeline should pre-generate that audio.
- In dark mode the 6-8 "Your color" swatches use light-mode colours.
- The demo is built from ReadWorks public passage text and its own original artwork.
