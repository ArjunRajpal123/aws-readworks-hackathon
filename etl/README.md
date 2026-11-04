# Sound Along ETL: P1 tokenize + P3 audio and timing

`pipeline.run()` turns a passage `{id, lang, title, text}` into what the Vue player reads:

```
sa/product/<id>.soundAlong.json          product record (contentTokenized, structure, tracks[], generation)
sa/audio/<id>/tts-1.mp3                  default voice (female: Danielle / Lupe)
sa/audio/<id>/tts-2.mp3                  second voice (male: Stephen / Pedro)
sa/audio/<id>/tts-N.timing.json.gz       {v, trackId, start[], end[], n, durationMs, textHash}
sa/audio/<id>/tts-N.marks.jsonl          Polly's raw word/sentence marks (review only)
sa/audio/<id>/tts-N.input.ssml           exact input sent to Polly (review only)
```

Stage 2 (audio) details and settings: [`docs/STAGE2_AUDIO.md`](../docs/STAGE2_AUDIO.md).

## Run locally and review

You need AWS credentials that can call Polly (the sandbox account is fine), [uv](https://docs.astral.sh/uv/), and Node for the player.

```bash
cd etl

# 1. Make inputs. Either a passage from docs/RW_Data.xlsx ...
uv run --with openpyxl python extract_passage.py --id E1 --max-words 150
# ... or the Stage 2 sample sentences: docs/RW_Sentences.xlsx -> inputs/rws-*.json
#     (already committed; re-run only if the workbook changes)
uv run --with openpyxl python extract_sentences.py

# 2. Generate audio + timing with real Polly (about $0.01 per short passage)
uv run python run_local.py "inputs/rws-*.json" --profile <your-profile>
#    `aws login` credentials also need: uv run --with "botocore[crt]" python run_local.py ...

# 3. Review
#    a) open frontend/public/sa/review.html: every passage, audio with word highlight,
#       click-to-play, QA checks, the exact SSML sent to Polly, cost
#    b) or in the team player:
cd ../frontend && npm install && npm run dev     # then http://127.0.0.1:5173/?m=rws-e9-en
```

Use `--track tts-1` to generate only the default voice (half the cost). To compare voices, run `audition.py inputs/rws-e9-en.json --voices Danielle,Stephen,Ruth --profile <your-profile>` and open `frontend/public/sa/audition/audition.html`.

`run_local.py` prints the AWS account it's using, uploads the pronunciation lexicons (`--no-lexicon` to skip), keeps going if one passage fails, and prints a summary table. The Stage 2 sample inputs (`inputs/rws-*.json`) are committed; other inputs and all generated output (`frontend/public/sa/`) are git-ignored.

## Run in the cloud (no local compute)

Upload an input file to the media bucket's `incoming/` prefix and the `etl-run` Lambda processes it (see `infra/cdk/README.md`):

```bash
aws s3 cp inputs/rws-e2-en.json s3://<media bucket>/incoming/
```

## Run against deployed AWS

`run_aws.py` runs the same pipeline but writes to the deployed `StorageStack`: S3 media bucket under `sa/` and the DynamoDB reference table (names come from the stack outputs). It takes the same inputs and options as `run_local.py` (`--profile`, `--track`, `--no-lexicon`, input `pronunciation`) and uploads the lexicons first.

```bash
cd etl
uv run python run_aws.py "inputs/rws-*.json" --profile <your-profile> --track tts-1
```

The caller needs `polly:SynthesizeSpeech`, `polly:PutLexicon`, `cloudformation:DescribeStacks`, `s3:PutObject` on the bucket, `dynamodb:PutItem` on the table and `kms:GenerateDataKey` on the storage key. The deployed API (`POST /api/v1/text-to-speech`, see `lambda/README.md`) runs this same pipeline. The data contract for all three entry points is [`docs/baseref.txt`](../docs/baseref.txt).

## Tests

```bash
uv run --with pytest --with openpyxl pytest etl/tests lambda/tests -q   # from the repo root; no AWS calls
```
