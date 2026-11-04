// Export the UI's full ReadWorks passages and comprehension questions (src/data_q.js) as
// pipeline inputs, so etl/run_local.py / run_aws.py can generate their Polly audio:
//
//   etl/inputs/rwf-<passage>-en.json      full passage, one paragraph per UI paragraph
//   etl/inputs/rwq-<passage>q<n>-en.json  one question: the question, then each choice as a paragraph
//
// The player splits each paragraph on whitespace, and so does the pipeline tokenizer, so the word
// counts match the timing files. Product ids are what src/data_full.js and src/questions.js request.
//
// Usage (from frontend/):  node scripts/export_inputs.mjs [outDir]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { QFULL } = await import(pathToFileURL(path.join(here, '..', 'src', 'data_q.js')).href)
const outDir = path.resolve(process.argv[2] || path.join(here, '..', '..', 'etl', 'inputs'))

export const fullId = pid => `rwf-${pid.toLowerCase()}-en`
export const questionId = qid => `rwq-${qid.toLowerCase()}-en`

const clean = s => String(s).replace(/\s+/g, ' ').trim()
const write = (rec) => {
  fs.writeFileSync(path.join(outDir, `${rec.id}.json`), JSON.stringify(rec, null, 2) + '\n')
  return rec.id
}

const ids = []
for (const [pid, it] of Object.entries(QFULL)) {
  const source = { file: 'frontend/src/data_q.js', passage: pid, readworksUuid: it.uuid, abridged: !!it.abridged }
  ids.push(write({
    id: fullId(pid), lang: 'en', title: `${it.title} (${pid}, full, en)`,
    text: it.paras.map(clean).filter(Boolean).join('\n\n'),
    source,
  }))
  for (const q of it.questions) {
    ids.push(write({
      id: questionId(q.id), lang: 'en', title: `${it.title} (${q.id}, en)`,
      text: q.paras.map(clean).filter(Boolean).join('\n\n'),
      source: { ...source, question: q.id, readworksQid: q.qid },
    }))
  }
}
console.log(`Wrote ${ids.length} inputs to ${outDir}`)
