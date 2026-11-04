# Lambda functions

Two Lambda functions backing `/api/v1/text-to-speech` behind API Gateway (Lambda-proxy integration):

| Method | Function | Handler | Purpose |
| --- | --- | --- | --- |
| POST | `text_to_speech_post` | `handler.handler` | Runs the Sound Along pipeline (`etl/pipeline.py`) on the given text: tokenize, SSML with the configured Polly Neural voices and lexicons, word timing, QA. Writes the same S3 files and DynamoDB product record as the ETL and returns the record with presigned URLs |
| GET | `text_to_speech_get` | `handler.handler` | Fetches a product record by `?id=` from the reference table and adds fresh presigned URLs |

There is one synthesis implementation in the repo: the ETL pipeline in `etl/`. The API does not have its own Polly or timing code. Voices, engine and naturalness settings come from `etl/voices.json` (Danielle/Stephen for en-US, Lupe/Pedro for es-US), never from the request. See [`docs/STAGE2_AUDIO.md`](../docs/STAGE2_AUDIO.md).

`common/` holds the Lambda-only helpers:

- `pipeline_runtime.py`: cached Polly client, `AwsStorage` for the bucket and table, lexicon upload once per container
- `s3_store.py`: presigned GET URLs (SigV4, regional endpoint) for `tracks[].audioKey` / `timingKey`
- `reference_store.py`: reads the product record from DynamoDB
- `responses.py`: API Gateway proxy responses

The full data contract (S3 layout, product record, timing file, API) is [`docs/baseref.txt`](../docs/baseref.txt).

`etl_run/` is the cloud ETL (not behind the API). An EventBridge rule fires it for every `incoming/*.json` uploaded to the media bucket. It runs the same `pipeline.run()` for every voice track, then moves the input to `processed/` (or to `failed/` with an `.error.json` for bad input). Unlike POST, it regenerates an existing id. See `infra/cdk/lib/etl-stack.ts`.

## Storage

Shared infra (`infra/cdk`'s `StorageStack`), not anything this endpoint provisions itself:

- **Media bucket** (S3, KMS-encrypted): `sa/product/<id>.soundAlong.json` and `sa/audio/<id>/<trackId>.{mp3,timing.json.gz,marks.jsonl,input.ssml}`. Same layout `etl/run_aws.py` writes and the Vue player reads.
- **Reference table** (DynamoDB, PK `id`, GSI `lang-index` on `lang`): one item per passage, the product record. `lang` is lowercase `en` / `es`.

The record stores only stable S3 keys (`audioKey`, `timingKey`), never a presigned URL. `urls` is signed fresh on every POST and GET response, so a link is valid for `TTS_URL_TTL_SECONDS` from when you fetched it, not from when the passage was generated.

## Environment variables

| Name | Required | Default | Notes |
| --- | --- | --- | --- |
| `TTS_MEDIA_BUCKET` | yes | — | Shared S3 media bucket (from `StorageStack`) |
| `TTS_REFERENCE_TABLE` | yes | — | Shared DynamoDB reference table (from `StorageStack`) |
| `TTS_S3_KEY_PREFIX` | no | `sa/` | Prefix for every key; record keys are relative to it |
| `TTS_URL_TTL_SECONDS` | no | `3600` | Presigned URL expiry |

## IAM

`ApiStack` grants:

- POST: `polly:SynthesizeSpeech` (`*`, no resource-level permissions), `polly:PutLexicon` / `polly:GetLexicon` on `lexicon/sa*`, read/write on the bucket, write on the table, plus the KMS actions for the storage key (via `grantReadWrite` / `grantWriteData`)
- GET: read on the bucket (presigning needs `s3:GetObject`) and the table

## API contract

**POST `/api/v1/text-to-speech`**

```json
{ "text": "Today is a good day.", "languageCode": "en-US", "id": "demo-1", "title": "Demo" }
```

| Field | Required | Notes |
| --- | --- | --- |
| `text` | yes | Non-empty. Over 3,000 characters is synthesized in parts; very long text can exceed the ~29 s API limit, so use the cloud ETL for full passages |
| `languageCode` | no | `en-US` (default) or `es-US`; `lang: "en"` also accepted |
| `id` | no | Starts with a letter or digit, then `[A-Za-z0-9._-]`, max 64 chars; default random hex. An id that already exists is rejected with **409** and nothing is written (use `etl/run_aws.py` to regenerate a passage) |
| `title` | no | At most 200 characters. Default: `id` |
| `voiceId` | no | A configured voice for the language (e.g. `Stephen`). Adds that track to the default one |
| `allVoices` | no | `true` generates every configured track |
| `pronunciation` | no | Per-token overrides, same format as ETL inputs, e.g. `{"3": {"w": "amazon:VB"}}` |

The legacy `engine` field is ignored. By default only the default track (`tts-1`) is generated, so a 3000-character request stays well inside the 25 s timeout. `voiceId` / `allVoices` double the Polly calls.

→ `201`: the product record plus response-only `urls`:

```json
{
  "schemaVersion": 3,
  "id": "demo-1",
  "lang": "en",
  "textHash": "sha256:...",
  "contentTokenized": "<p><span data-w=\"0\">Today</span> ...</p>",
  "structure": { "paragraphStarts": [0], "sentenceStarts": [0] },
  "tracks": [
    { "id": "tts-1", "voiceId": "Danielle", "audioKey": "audio/demo-1/tts-1.mp3",
      "timingKey": "audio/demo-1/tts-1.timing.json.gz", "granularity": "word",
      "qa": { "status": "passed", "...": "..." } }
  ],
  "generation": { "pipelineVersion": "sa-pipeline-0.3.1", "...": "..." },
  "urls": {
    "tts-1": {
      "audio": "https://<bucket>.s3.us-west-2.amazonaws.com/sa/audio/demo-1/tts-1.mp3?X-Amz-...",
      "timing": "https://<bucket>.s3.us-west-2.amazonaws.com/sa/audio/demo-1/tts-1.timing.json.gz?X-Amz-..."
    }
  }
}
```

→ `400` validation error, `502` Polly/S3/DynamoDB failure, both as `{"error": "..."}`.

**GET `/api/v1/text-to-speech?id=demo-1`**

→ `200`: same shape as the POST response, loaded from the reference table, with fresh `urls`. Works for catalog passages written by `etl/run_aws.py` too.
→ `400` without `id`, `404` if the id doesn't exist.

## Tests (offline)

```bash
make test                                        # from lambda/
uv run --with pytest pytest lambda/tests -q      # or from the repo root
```

Fake Polly / S3 / DynamoDB, no AWS calls. The suite covers the pipeline wiring, voice selection, validation, error mapping and presigned URL shape.

## Running locally against AWS

Requires AWS credentials with Polly + S3 + DynamoDB access. Both handlers call real AWS services. `scripts/invoke_local.py` puts `../etl` on `sys.path`, the same as the bundle layout in Lambda.

```bash
cd lambda
cp .env.example .env   # fill in TTS_MEDIA_BUCKET + TTS_REFERENCE_TABLE (StorageStack outputs)
make run-post TEXT="Hello world" ID=demo-1
make run-post TEXT="Hola. ¿Cómo estás?" LANGUAGE_CODE=es-US VOICE_ID=Pedro
make run-get ID=demo-1
```

`make install` creates a `.venv` and installs `requirements.txt` on first run. `.env` is sourced before each invoke. `make clean` removes the venv.

## Calling the deployed API

`lambda/bruno/` is a [Bruno](https://www.usebruno.com/) collection for the two endpoints. Open the `lambda/bruno` folder in Bruno, set `baseUrl` in the `dev` environment to the `ApiUrl` stack output (minus the `/api/v1/text-to-speech` path), then run `Create (POST)` followed by `Get (GET)` (it reuses the id the POST returned).

## Deploying

Packaged and deployed by `infra/cdk` (`ApiStack`, `infra/cdk/lib/api-stack.ts`). Python 3.13 runtime (Lambda has no 3.14 yet; the code runs on both). Each function bundle is its handler directory, a copy of `common/`, and the `etl/` pipeline modules (`audio`, `mp3duration`, `pipeline`, `ssml`, `storage`, `tokenizer`, `voices`, `voices.json`, `lexicons/`) at the bundle root. Asset hashing is on the bundled output, so changes in `etl/` redeploy the functions.
