# Sound Along UI

*Front end for the ReadWorks x AWS hackathon team.*

Browser front end for Sound Along: read-along highlighting, tap-to-replay, Word Stops, word cards, four grade-band looks (K-2, 3-5, 6-8, 9-12), English and Spanish, accessibility options, and light/dark mode.

Vue 3 + Vite. No other runtime libraries.

## Run

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # output in dist/
```

Pick a passage from the **Passage** menu under the title: the original demo passages (with Word Stops and word cards), nine full ReadWorks grade-4 passages with their question sets (`rwf-E1` to `rwf-E9`), or the same nine as short sentence sets for testing tricky text (`rw-E1` to `rw-E9`). The tabs change the grade-band look and the language switch changes the whole interface and the passage.

Open a specific one with `?m=`: demo passages `k2`, `35`, `68`, `912` (add `es` for Spanish, for example `912es`); ReadWorks sentence sets `rw-E8-35`, `rw-E3-68es` (passage, band, optional `es`).

## Where things are

| File | What it is |
|---|---|
| `src/App.vue` | Page markup (teal bar, title band, tabs, player, sidebar, accessibility panel, footer) |
| `src/style.css` | All styles, including the four grade-band looks and the dark theme (tokens at the top) |
| `src/engine.js` | Player and Word Stop logic: playback, highlight, tap to replay, stops, cards, accessibility, theme, language |
| `src/data.js` | Demo passages, vocabulary cards and Word Stops (English and the K-2 Spanish passage) |
| `src/assist.js`, `src/vocab_db.js`, `src/rate.js`, `src/assist_i18n.js` | Admin form assist (detect language, level, known passages and vocabulary; optional AI suggestions), the finish pop-up and the Rate dialog. |
| `src/admin.js`, `src/admin_i18n.js` | Admin screen (small yellow **Admin** button at the top left): add content by pasting text, uploading files, a ReadWorks link or a bulk CSV/ZIP, set the options for the pipeline, and see a simulated queue. **Demo only: nothing is uploaded or sent.** The request box shows the shape the pipeline would receive; replace the submit handler with the real pipeline call. |
| `src/questions.js`, `src/q_i18n.js` | ReadWorks comprehension questions: multiple choice is scored in the page, written responses show the ReadWorks sample answer, and each question has neural audio that reads it and its choices with word highlighting. |
| `src/data_full.js`, `src/data_q.js` | Nine full grade-4 ReadWorks passages and their question sets (from the public ReadWorks passage data). English text; the Spanish interface works, the Spanish passage is pending. |
| `src/data_rw.js` | The nine ReadWorks grade-4 sentence sets (English copied from ReadWorks; Spanish is a **machine-translated draft**) |
| `src/data_es.js` | Spanish passages, cards and Word Stops for 3-12 (**machine-translated drafts, not reviewed**) |
| `src/i18n.js` | Interface text, English and Spanish (Spanish is a machine-translated draft) |
| `docs/PIPELINE.md` | What the backend pipeline must produce for this UI (handoff to engineering) |
| `docs/PLAN.md` | UI plan: Polly wiring and full Spanish |
| `docs/INTAKE.md` | Proposed intake fields for the pipeline (the Admin screen mirrors them) |
| `docs/RESEARCH.md` | Learning-research memo: ideas to make the player different and how they fit inside the ReadWorks platform |



## How to use button

A **How to use** button in the top bar (on the reading page and on the Admin screen) starts a step-by-step walkthrough that dims the page, outlines one feature at a time and explains it. Arrow keys move between steps and Escape closes it. Steps for features that are not on screen are skipped.

## What is in the reading screen

- **Info (i) buttons** next to Support, Word Stops and Game features open a short explanation of what each is and what it is good for. Support lists Listen, Follow, Echo and Your turn.
- **Text size** buttons (A- and A+) sit just above the passage text.
- The top bar follows the ReadWorks pattern: Content, My Tools (Accessibility and Dark mode), Assignments & Progress and Class Admin, with How to use, the English / Español switch and the profile on the right. On phones the links collapse into a menu button.

- A small note under the player says the voice is computer-generated and names the voice that was picked.
- **Resume**: stop part way through a passage and a bar offers Resume the next time it is opened (the position is kept in the browser).
- **Finish screen**: when a passage ends, a pop-up shows stars, the words the student collected (cards opened and words tapped), words to try next, and the four choices. Collected words are saved to My Words.
- The passage menu shows each passage by name with its grade and Lexile.

## Passages by grade band

Each grade band (K-2, 3-5, 6-8, 9-12) has its own passages, and the passage menu only lists the ones for the band that is open. Switching bands opens that band's passage and its own look.

- K-2, 3-5 and 9-12 each have a built-in passage with Word Stops. 3-5 also has the nine full ReadWorks passages (grade 4) with their question sets.
- The other passages (K-2: The Red Wagon, Why Leaves Change Color, Ana and the Lost Kitten; 6-8: How Bees Find Flowers, The Last Page of the Library, Why the Moon Has Phases; 9-12: How the Printing Press Changed the World, How Vaccines Train the Immune System, The Weight of an Unsent Letter) are original texts written for Sound Along, with key words and four multiple-choice questions each (`src/data_grade.js`). They have no Polly audio yet, so the browser voice reads them until the pipeline produces audio.
- Every passage has an original illustration drawn in SVG (`src/art.js`), shown above the text.
- Each passage also has a photo in `public/img/` named after the passage id (for example `rwf-E1.jpg`). The photos come from Wikimedia Commons under public domain, CC0, CC BY or CC BY-SA licenses. The credit for each (author, license and link) is in `public/img/credits.json` and is shown under the picture. If a photo is missing, the drawing is used. To change a photo, replace the file and its entry in `credits.json`. The ReadWorks passages link to the original passage on readworks.org, where ReadWorks' own images are.
- `src/catalog.js` lists every passage with its band, grade, key words and player mode ids.

## Game features by grade band

Game features are optional and off by default. Word Stops are pre-written multiple choice with fixed feedback: students pick an answer, they never type one, and nothing is generated by AI.

- **K-2:** tap a word with a dotted line to add it to the glow jar.
- **3-5:** each solved Word Stop earns a detective badge for its clue type, with a short "Badge earned" message. Passages without Word Stops say so and offer one that has them.
- **6-8:** each Word Stop uses a clue type (word parts, restatement, definition or contrast). Answering on the first try builds a streak, and the panel counts the clue types used.
- **9-12:** each solved Word Stop saves the word and its clue type to a word bank that can be copied.

The original 6-8 and 9-12 passages have their stops in `src/grade_stops.js`, so the content team can edit the questions and answers there.

## What to read next

The **What's next** button (in the player, and on the finish pop-up) lists readings assigned by a teacher or family member, more readings on the same topic, and a step up.

## Linked profiles

The **Profile** button (top right of the dark strip) switches who is using the app. Students, parents and teachers are linked in `src/people.js`: four classes (grades 2, 4, 7 and 10), six students each, parents (one parent has two children in different grades) and four teachers.

- **Student**: opens at the student's grade, with assigned readings under What's next. What the student reads is saved to their reading log (passage, when finished, time spent, words covered, question score).
- **Parent**: opens the family view for their children.
- **Teacher**: opens their class.

Each class has a generated reading history (the same every time) so the screens have something to show. Anything done in the browser is added on top and is shared across profiles, so a student reading as Maya shows up for Maya's teacher and parent, and a reading a teacher assigns shows under What's next for the student.

## Teacher and parent views

The **Teachers & families** button opens the views.

- **Teacher**: class totals, suggestions for the class, a sortable student table with notes (not read lately, rushing, struggling, ready to move up), words the class should revisit, and per-passage results. Select a student for their reading log (each reading expands to show the words covered), words with strength meters, assigned readings, and suggestions. Teachers can assign a reading to a student or the whole class, and start a whole-class word warm-up.
- **Parent or family**: choose a child, see what is up next, the reading log, words to go over again with a flashcard practice, suggestions (including a conversation question about the last passage), and the voice and privacy notes. Parents can send their child a reading.

Suggestions come from simple rules (days since last read, time against expected time, question scores, and how often a word has been covered), not from AI. Reading history, assignments, practice results and the chosen profile are kept in the browser only (`sa-sessions`, `sa-assign`, `sa-practice`, `sa-profile`, `sa-ratings`, `ws-pos-*`). The team's service would replace these with real student, class and family data.

## Reading flow, voices and feedback

- Passages that have a question set show **Passage** and **Questions** tabs; the questions are not under the passage.
- When playback reaches the end, a pop-up offers **Listen again**, **Keep reviewing the passage**, **Go to the questions** (when there are some) and **Tell us how it went**. It has a close button (X), closes on Escape or a tap outside, and works on phones.
- **Tell us how it went** (and the **Rate** button in the player) asks whether the content was helpful and how the voice sounded, with an optional comment. Ratings are kept in the browser and appear on the Admin screen under Feedback; the record, including the voice that was playing, is in `docs/INTAKE.md`, section 14.
- A **Voice** menu lets students choose: English Danielle (female) or Stephen (male); Spanish Lupe (female) or Pedro (male). The player plays the track in the passage's `soundAlong` record whose `voiceId` matches. If the passage has no track for that voice yet, the default track plays and the page says which voice is playing.

## Admin form assist

The Admin form fills in what the text already tells us (language, reading level and grade band, a title guess, a match to a known ReadWorks passage and its details, and words already in the vocabulary database), marking each filled field until it is edited. The optional **Fill in with AI** button sits under the text box. It asks for confirmation and then suggests values for empty fields. The suggestions are simulated in the browser; set `window.SA_AI_ENDPOINT` to call a real service (request and response in `docs/INTAKE.md`, section 14).

## Pinned audio bar

The audio bar is a slim strip that stays pinned at the top for the whole passage, so a student can pause or skip from anywhere in the text. The speed, voice, support, What's next and Rate options sit just below it and scroll with the page.

## Audio player

Modelled on a music player: previous and next sentence, back and forward 5 seconds, a draggable scrubber with elapsed and remaining time and sentence marks, repeat this sentence, speed (0.75x to 1.5x), mute, and a sticky bar that stays at the top while you scroll. It also sets the phone's lock-screen and headset controls through the Media Session API (play, pause, seek, previous and next sentence). Shift + Left and Shift + Right skip by sentence.

The **Support** menu next to Speed fades the audio help: *Listen* (word by word), *Follow* (phrase by phrase), *Echo* (one sentence, then the student reads it), *Your turn* (tap a word to hear just that word).

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
