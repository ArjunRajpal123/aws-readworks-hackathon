# Lambda functions

Two Lambda functions backing `/api/v1/text-to-speech` behind API Gateway (Lambda-proxy integration):

| Method | Function | Handler | Purpose |
| --- | --- | --- | --- |
| POST | `text_to_speech_post` | `handler.handler` | Synthesizes audio + word timing via Polly, stores text/audio in the shared media bucket, writes the record to the shared reference table, returns the record |
| GET | `text_to_speech_get` | `handler.handler` | Fetches a previously stored record by `?id=` from the reference table |

`common/` holds shared Polly, S3, DynamoDB and response helpers; package it alongside each handler when zipping/deploying (each function needs its own copy of `common/`).

Word-level timing uses Polly's synchronous `SynthesizeSpeech` with `SpeechMarkTypes=["word"]`, which requires the `neural` or `standard` engine (not `generative`) — see `common/polly.py`.

Storage is the shared infra (`infra/cdk`'s `StorageStack`), not anything this endpoint provisions itself:
- **Media bucket** (S3, KMS-encrypted) — text and audio blobs, under `tts/texts/` and `tts/audio/` prefixes (kept separate from the main passage pipeline's eventual key layout).
- **Reference table** (DynamoDB, PK `id`, GSI `lang-index` on `lang`) — one item per request: `id`, `lang`, `text_path`/`text`, `audio_path`/`audio`, `timestamp`. `lang` is the 2-letter code derived from `languageCode` (e.g. `en-US` → `EN`), so the table's language GSI also covers these rows.

## Environment variables

| Name | Required | Default | Notes |
| --- | --- | --- | --- |
| `TTS_MEDIA_BUCKET` | yes | — | Shared S3 media bucket (from `StorageStack`) |
| `TTS_TEXT_S3_KEY_PREFIX` | no | `tts/texts` | Key prefix for stored source text |
| `TTS_AUDIO_S3_KEY_PREFIX` | no | `tts/audio` | Key prefix for generated audio |
| `TTS_REFERENCE_TABLE` | yes | — | Shared DynamoDB reference table (from `StorageStack`) |
| `TTS_URL_TTL_SECONDS` | no | `3600` | Presigned URL expiry for `text`/`audio` links |
| `TTS_DEFAULT_VOICE_ID` | no | `Joanna` | Overridable per-request via `voiceId` |
| `TTS_DEFAULT_ENGINE` | no | `neural` | Overridable per-request via `engine`; must support word speech marks |
| `TTS_DEFAULT_LANGUAGE_CODE` | no | `en-US` | Overridable per-request via `languageCode` |

## IAM

Each function's execution role needs:
- `polly:SynthesizeSpeech`
- `s3:PutObject`/`s3:GetObject` on `TTS_MEDIA_BUCKET/*` plus `kms:GenerateDataKey`/`kms:Decrypt` on the bucket's key (POST writes text+audio, GET only reads — both presign, which requires read)
- `dynamodb:PutItem` (POST) / `dynamodb:GetItem` (GET) on `TTS_REFERENCE_TABLE` plus the matching `kms:Decrypt`/`kms:GenerateDataKey` on the table's key

`infra/cdk`'s `ApiStack` grants all of this via `bucket.grantReadWrite`/`grantRead` and `table.grantWriteData`/`grantReadData`, which also cover the KMS actions for each resource's customer-managed key.

## API contract

**POST `/api/v1/text-to-speech`**
```json
{ "text": "Hello world", "voiceId": "Joanna", "languageCode": "en-US", "engine": "neural" }
```
→ `201`
```json
{
  "id": "6f1e2c...",
  "lang": "EN",
  "text_path": "tts/texts/6f1e2c....txt",
  "text": "https://s3.../tts/texts/6f1e2c....txt?...",
  "audio_path": "tts/audio/6f1e2c....mp3",
  "audio": "https://s3.../tts/audio/6f1e2c....mp3?...",
  "timestamp": [
    { "id": 0, "s": 0, "e": 320, "block": "Hello" },
    { "id": 1, "s": 320, "e": 320, "block": "world" }
  ]
}
```
`*_path` is the raw S3 key (stable, no expiry); `text`/`audio` are presigned GET URLs that expire after `TTS_URL_TTL_SECONDS`.

**GET `/api/v1/text-to-speech?id=6f1e2c...`**
→ `200` — same shape as the POST response, loaded back from the reference table.
→ `404` if `id` doesn't exist.

## Running locally

Requires AWS credentials (e.g. `aws sso login` or exported keys) with Polly + S3 + DynamoDB access, since both handlers call real AWS services — there's no mocking here.

```bash
cd lambda
cp .env.example .env   # fill in TTS_MEDIA_BUCKET + TTS_REFERENCE_TABLE (must already exist) and region
make run-post TEXT="Hello world"
make run-get ID=<id-from-the-post-response>
```

`make install` creates a `.venv` and installs `requirements.txt` automatically on first run. `.env` is sourced before each invoke. `make clean` removes the venv.

## Calling the deployed API

`lambda/bruno/` is a [Bruno](https://www.usebruno.com/) collection for the two endpoints — open the `lambda/bruno` folder in Bruno, set `baseUrl` in the `dev` environment to the `ApiUrl` stack output (minus the `/api/v1/text-to-speech` path), then run `Create (POST)` followed by `Get (GET)` (it reuses the id the POST returned).

## Deploying

These two functions are packaged and deployed by `infra/cdk` (`ApiStack`, in `infra/cdk/lib/api-stack.ts`) — Python 3.14 runtime, each bundled with its own copy of `common/`, behind an API Gateway HTTP API at `/api/v1/text-to-speech`. `ApiStack` takes the media bucket and reference table as props from `StorageStack` and sets all `TTS_*` environment variables above; see `infra/cdk/README.md`.
