*Draft concept for the ReadWorks x AWS hackathon team, Nov 3, 2026. Proposed fields for engineering to react to. Not a ReadWorks product.*

# Sound Along: proposed intake fields

What an admin enters (or the system fills in) when new content goes into the pipeline. The key names match the request shown on the Admin screen of the demo, so the demo and the API can stay in step. Limits marked "proposed" are suggestions, not decisions.

**Filled by:** *Admin* = a person types or picks it. *Source* = pulled from ReadWorks passage data when a ReadWorks ID is given. *System* = generated, never typed.

## 1. Submission (applies to the whole request)

| Field | Type | Required | Values and limits | Default | Filled by |
|---|---|---|---|---|---|
| `batchLabel` | text | no | up to 80 characters | none | Admin |
| `dryRun` | true/false | no | true returns the estimate and checks, queues nothing | false | Admin |
| `priority` | choice | no | `normal`, `high` | `normal` | Admin |
| `notifyEmail` | email | no | one address | none | Admin |
| `submittedBy` | text | yes | user id from sign-in | | System |
| `submittedAt` | date-time | yes | UTC | | System |
| `idempotencyKey` | text | yes | same key twice returns the first result | | System |

## 2. Content (where the text comes from)

Exactly one `input.method`.

| Field | Type | Required | Values and limits | Filled by |
|---|---|---|---|---|
| `input.method` | choice | yes | `paste`, `file`, `readworks`, `bulk` | Admin |
| `input.text` | text | if `paste` | at least 40 characters; proposed maximum 100,000 characters (the Polly asynchronous limit per request) | Admin |
| `input.files[]` | list | if `file` | `.txt .md .html .json .docx .pdf .rtf`; proposed 5 MB per file | Admin |
| `input.files[].name`, `.bytes`, `.mime`, `.storageKey` | text/number | yes | storage key assigned on upload | System |
| `input.readworksId` | text | if `readworks` | a UUID, or a readworks.org article link the UI reduces to its UUID | Admin |
| `input.bulkFile` | file | if `bulk` | `.csv` (one row per passage) or `.zip` of text files plus a `.csv` that names them; proposed 500 rows | Admin |
| `input.characters` | number | yes | counted after cleaning | System |
| `textHash` | text | yes | hash of the word list; same hash as the last run means stop, no cost | System |

## 3. About the passage

| Field | Type | Required | Values and limits | Filled by |
|---|---|---|---|---|
| `passage.title` | text | yes (not needed for ReadWorks ID) | up to 200 characters | Admin / Source |
| `passage.author` | text | no | | Admin / Source |
| `passage.language` | choice | yes (not needed for ReadWorks ID) | `en-US`, `es-US` | Admin / Source |
| `passage.gradeBand` | choice | yes | `k2`, `35`, `68`, `912` | Admin / Source |
| `passage.grade` | choice | no | `K`, `1` to `12` | Admin / Source |
| `passage.lexile` | text | no | for example `590L`, `BR120L`; no Lexile allowed | Admin / Source |
| `passage.genre` | choice | yes | `fiction`, `nonfiction`, `poetry`, `drama`, `other` | Admin / Source |
| `passage.topic` | text | no | subject or topic | Admin / Source |
| `passage.readworksId` | text | no | set if the passage already exists | Admin |
| `passage.pairedPassageId` | text | no | the English or Spanish partner of a paired text | Admin / Source |
| `passage.sourceUrl` | url | no | where the text came from | Admin |

## 4. Rights

| Field | Type | Required | Values and limits | Filled by |
|---|---|---|---|---|
| `passage.rights.source` | choice | yes | `readworks`, `public-domain`, `licensed`, `other` | Admin |
| `passage.rights.confirmed` | true/false | yes | must be true to submit | Admin |
| `passage.rights.notes` | text | if `licensed` or `other` | licence details or attribution | Admin |

## 5. Text handling

| Field | Type | Default | Notes |
|---|---|---|---|
| `text.excludeFigures` | true/false | true | Drops figures and captions before numbering words |
| `text.keepVocabularyTags` | true/false | true when ReadWorks ID given | Keeps the existing vocabulary markup around words |
| `tokenizerVersion` | text | per language, System | `sa-tok-en-1.0`, `sa-tok-es-1.0`. Spanish keeps the inverted marks and accents attached to the word |

## 6. What the pipeline should do (`pipeline`)

Word numbering and timing (`pipeline.tokenize`) is always on.

| Field | Type | Default | Values and limits | AI used? |
|---|---|---|---|---|
| `pipeline.audio.enabled` | true/false | true | | no |
| `pipeline.audio.languages[]` | list | both | `en-US`, `es-US` | no |
| `pipeline.audio.engine` | choice | `polly-neural` | read only; changing it needs approval | no |
| `pipeline.audio.voices` | map | from config | English `Danielle` (female) and `Stephen` (male); Spanish `Lupe` (female) and `Pedro` (male). One audio track per voice so students can choose. Set in pipeline settings, not per passage | no |
| `pipeline.humanAudio.file` | file | none | an existing MP3 (or the ReadWorks audio name); the pipeline only adds word timing by alignment | no |
| `pipeline.pronunciation[]` | list | none | each `{word, say, language}`, for names such as Hunsford and Rosings | no |
| `pipeline.spanishVersion.mode` | choice | `readworks-paired` if a pair exists, else `ai-draft` | `readworks-paired`, `provided`, `ai-draft`, `none` | yes, draft |
| `pipeline.spanishVersion.glossary[]` | list | none | each `{en, es}`, keeps key terms consistent | no |
| `pipeline.vocabularyCards.enabled` | true/false | true | | yes for Spanish, draft |
| `pipeline.vocabularyCards.languages[]` | list | both | | |
| `pipeline.vocabularyCards.words[]` | list | from ReadWorks vocabulary | optional override, each `{word, senseId}` | |
| `pipeline.wordStops.enabled` | true/false | true | | yes, draft |
| `pipeline.wordStops.bands[]` | list | all four | `k2`, `35`, `68`, `912` | |
| `pipeline.wordStops.types[]` | list | by band | `picture_choice`, `multiple_choice`, `tap_clue`, `written` | |
| `pipeline.wordStops.maxPerPassage` | number | 3 | proposed 1 to 6 | |
| `pipeline.wordStops.audio` | true/false | true | pre-generated audio for each question, choice and feedback line | no |
| `pipeline.wordStops.pictureChoices` | true/false | false | needs a decision on where the images come from | open |

## 7. Comprehension questions

What the public ReadWorks passage record already holds (checked on nine grade-4 passages): `questionSets`, with a set id (`qsid`), usually ten questions, and `abridged_question_ids` (a short set of five).

- **Multiple choice** (`type` 0): question text, four lettered choices, each with an `answerId` and a `correct` flag.
- **Written response** (`type` 1): question text and one `correct` answer that works as a sample answer. One passage in the nine (Losing Power) has only written-response questions.
- Question and answer text arrives as HTML (spans, entities). It is cleaned to plain text before audio.

| Field | Type | Default | Values and limits | AI used? |
|---|---|---|---|---|
| `questions.source` | choice | `readworks-import` if a ReadWorks ID is given | `readworks-import`, `upload`, `ai-draft`, `none` | only for `ai-draft` |
| `questions.set` | choice | `full` | `full`, `abridged` (the five ReadWorks lists as abridged) | no |
| `questions.file` | file | none | CSV or JSON, if `upload`; same shape as the ReadWorks set (type, question, choices with one correct, sample answer) | no |
| `questions.languages[]` | list | follows the passage | Spanish questions are an AI draft and need review | yes for Spanish, draft |
| `questions.audio` | true/false | true | One audio per question that reads the question, then "A", "B", "C", "D" with each choice; word timing is produced the same way as for the passage so words highlight as they are read | no |
| `questions.evidenceHighlight` | true/false | false | Links each correct answer to the word numbers that support it. **Not in the ReadWorks data**, so it needs an AI draft step and review | yes, draft |
| `questions.kinds[]` | list | both | `literal`, `inferential` (only for `ai-draft`; ReadWorks sets are not tagged this way in the record) | |

Rules: multiple-choice scoring uses the ReadWorks `correct` flag and happens in the browser. Written answers are not stored. The question audio id and its word list (question first, then lettered choices) must be created together so the highlight matches.

## 8. Review and publish (`review`)

| Field | Type | Default | Values and limits |
|---|---|---|---|
| `review.mode` | choice | `required` | `required`, `auto` (publish when all automatic checks pass) |
| `review.reviewers[]` | list | none | names or emails |
| `review.spanishReviewer` | text | none | needed when any Spanish text is AI-drafted |
| `review.dueDate` | date | none | |
| `review.afterApproval` | choice | `draft` | `draft`, `staging`, `published` |
| `review.notes` | text | none | shown to the reviewer; licence details go here too |

## 9. Created by the system (never typed)

`passageId`, `versionId`, `runId`, `schemaVersion`, `textHash`, `tokenCount`, per-stage status and timestamps, automatic check results (every word timed, times increasing, last word before the audio ends, fallback to sentence highlight), actual Polly characters and cost per language, who approved and when, and links to the finished files.

## 10. Bulk CSV columns

`title, author, language, gradeBand, grade, lexile, genre, topic, readworksId, pairedPassageId, rights, textFile`. Pipeline options in a bulk run use the defaults above unless the request sets them for the whole batch.

## 11. Rules the API should enforce

- A request is rejected, with every problem listed at once, if a required field is missing, the rights box is not confirmed, or the text is under 40 characters.
- The same `idempotencyKey` never creates a second run.
- Changing the text creates a new version, a new `textHash`, and re-runs everything that depends on the words (audio, timing, Spanish, cards, questions).
- Anything AI-written starts as `draft` and is not shown to students until it passes the checks and, if `review.mode` is `required`, is approved.
- Nothing AI-generated is created when a student opens a passage.

## 12. Example request

```json
{
  "batchLabel": "Fall grade 4 sample",
  "input": { "method": "paste", "text": "It was a very peaceful place. …" },
  "passage": {
    "title": "The Most Important Question", "language": "en-US", "gradeBand": "35", "grade": "4",
    "genre": "fiction", "rights": { "source": "readworks", "confirmed": true }
  },
  "pipeline": {
    "tokenize": true,
    "audio": { "enabled": true, "languages": ["en-US", "es-US"] },
    "spanishVersion": { "mode": "ai-draft" },
    "vocabularyCards": { "enabled": true, "languages": ["en-US", "es-US"] },
    "wordStops": { "enabled": true, "bands": ["35"], "audio": true }
  },
  "questions": { "source": "readworks-import", "audio": true, "evidenceHighlight": true },
  "review": { "mode": "required", "spanishReviewer": "name@example.org", "afterApproval": "staging" }
}
```

## 13. Questions for the dev team

1. One request per passage, or can a batch carry per-passage overrides?
2. Where do uploaded files live before the run (a staging prefix in the same bucket, or a separate one), and how long are they kept?
3. How does the admin screen learn each stage's status: polling, or pushed events?
4. Which of these limits (file size, row count, text length) does the team want to set?
5. Is the sign-in and role model (admin, editor, reviewer) provided by the platform, or part of this build?

## 14. Form assist and feedback (UI contract)

**Fill from the text (runs in the browser, no AI).** After text is pasted, a file is read, or a ReadWorks link is entered, the form fills what the text already tells us and marks each field "Filled from your text" until the admin edits it: language (from common words and accents), reading-level estimate and grade band (sentence and word length), a title guess (a short first line or the file name), and, when the text matches a known ReadWorks passage, its title, author, genre, Lexile, ReadWorks ID and rights. It also lists words that already exist in the vocabulary database. Anything the admin has edited is never overwritten.

**Fill with AI (optional button under Submit).** A confirmation says what is sent and that suggestions need review. Only empty fields are suggested, each marked "AI suggestion: check it". The demo simulates this in the browser. The real button calls a service when `window.SA_AI_ENDPOINT` is set:

```
POST {SA_AI_ENDPOINT}
{ "text": "...", "language": "en-US" }

200 OK
{ "fields": { "title": "...", "author": "...", "genre": "fiction", "topic": "...",
              "gradeBand": "35", "grade": "4", "language": "en-US", "lexile": "590L" },
  "vocabulary": ["word", "word"] }
```

The submission records what was used: `assist.detected` (language, estimated grade and band, matched ReadWorks ID, number of vocabulary words found, fields filled) and `assist.ai` (`used`, `mode`, fields and vocabulary suggested). Vocabulary words from the database go in `pipeline.vocabularyCards.words` with `source: "database"`; AI-suggested words with `source: "ai-suggested"` and `needsReview: true`.

**Student feedback (the Rate button and the finish pop-up).** Each rating is one record. The demo keeps it in the browser; the team's service would collect it.

| Field | Type | Notes |
|---|---|---|
| `passage` | text | the passage and grade-band mode id |
| `audio` | text | the audio id that was playing |
| `helpful` | true/false | "Was this content helpful?" |
| `audioGood` | true/false | "How did the voice sound?" (good, or could be better): the audio quality check |
| `voice` | text | the voice that was playing (for example `Danielle`), or `browser` when no audio file was used |
| `comment` | text | optional, up to 500 characters |
| `at` | date-time | UTC |

### Voices in the soundAlong record

Students choose a voice in the player (English: Danielle or Stephen; Spanish: Lupe or Pedro). The `soundAlong` record lists one entry in `tracks[]` per voice, each with its own `voiceId`, `audioKey`, `timingKey` and quality result. The player plays the track whose `voiceId` matches the student's choice. If a passage has no track for that voice yet, it plays the default track and says which voice it is playing. The same rule applies to the audio for each comprehension question.
