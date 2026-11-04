# Sound Along ETL: P1 tokenize + P3 audio and timing

`pipeline.run()` turns a passage `{id, lang, title, text}` into what the Vue player reads:

```
sa/product/<id>.soundAlong.json          product record (contentTokenized, structure, tracks[0], generation)
sa/audio/<id>/tts-1.mp3                  Polly Neural audio
sa/audio/<id>/tts-1.timing.json.gz       {v, trackId, start[], end[], n, durationMs, textHash}
sa/audio/<id>/tts-1.marks.jsonl          Polly's raw word/sentence marks (review only)
sa/audio/<id>/tts-1.input.ssml           exact input sent to Polly (review only)
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

`run_local.py` prints the AWS account it's using, uploads the pronunciation lexicons (`--no-lexicon` to skip), keeps going if one passage fails, and prints a summary table. The Stage 2 sample inputs (`inputs/rws-*.json`) are committed; other inputs and all generated output (`frontend/public/sa/`) are git-ignored.

## Tests

```bash
uv run --with pytest --with openpyxl pytest etl/tests -q     # from the repo root; no AWS calls
```
