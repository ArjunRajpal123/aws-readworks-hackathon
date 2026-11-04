# Lambda functions

Two Lambda functions backing `/api/v1/text-to-speech` behind API Gateway (Lambda-proxy integration):

| Method | Function | Handler | Purpose |
| --- | --- | --- | --- |
| POST | `text_to_speech_post` | `handler.handler` | Runs the Sound Along pipeline (`etl/pipeline.py`) on the given text: tokenize, SSML with the configured Polly Neural voices and lexicons, word timing, QA. Writes the same S3 files and DynamoDB product record as the ETL and returns the record with presigned URLs |
| GET | `text_to_speech_get` | `handler.handler` | Fetches a product record by `?id=` from the reference table and adds fresh presigned URLs |

There is one synthesis implementation in the repo: the ETL pipeline in `etl/`. The API does not have its own Polly or timing code. Voices, engine and naturalness settings come from `etl/voices.json` (Danielle/Stephen for en-US, Lupe/Pedro for es-US), never from the request. See [`docs/STAGE2_AUDIO.md`](../docs/STAGE2_AUDIO.md).

`common/` holds the Lambda-only helpers:

Storage is the shared infra (`infra/cdk`'s `StorageStack`), not anything this endpoint provisions itself:
- **Media bucket** (S3, KMS-encrypted) — text and audio blobs, under `text/` and `audio/` prefixes, matching the passage data contract in `docs/baseref.txt`.
- **Reference table** (DynamoDB, PK `id`, GSI `lang-index` on `lang`) — one item per request: `id`, `lang`, `text_path`, `audio_path`, `timestamp`. `lang` is the 2-letter code derived from `languageCode` (e.g. `en-US` → `EN`), so the table's language GSI also covers these rows.

The table stores only the stable `*_path` S3 keys, never a presigned URL — `text`/`audio` are generated fresh on every POST and GET response (see `common/s3_store.presigned_url`), so a link is always valid for `TTS_URL_TTL_SECONDS` from whenever you actually fetched it, not from when the record was created.

## Environment variables

| Name | Required | Default | Notes |
| --- | --- | --- | --- |
| `TTS_MEDIA_BUCKET` | yes | — | Shared S3 media bucket (from `StorageStack`) |
| `TTS_TEXT_S3_KEY_PREFIX` | no | `text` | Key prefix for stored source text |
| `TTS_AUDIO_S3_KEY_PREFIX` | no | `audio` | Key prefix for generated audio |
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
| `text` | yes | Non-empty, at most 3000 characters (Polly synchronous cap) |
| `languageCode` | no | `en-US` (default) or `es-US`; `lang: "en"` also accepted |
| `id` | no | `[A-Za-z0-9._-]{1,64}`, default random hex. An existing id is regenerated |
| `title` | no | Default: `id` |
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
