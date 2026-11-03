# Lambda functions

Two Lambda functions backing `/api/v1/text-to-speech` behind API Gateway (Lambda-proxy integration):

| Method | Function | Handler | Purpose |
| --- | --- | --- | --- |
| POST | `text_to_speech_post` | `handler.handler` | Synthesizes audio + word timing via Polly, stores text/audio/record in S3, returns the record |
| GET | `text_to_speech_get` | `handler.handler` | Fetches a previously stored record by `?id=` |

`common/` holds shared Polly, S3 and response helpers; package it alongside each handler when zipping/deploying (each function needs its own copy of `common/`).

Word-level timing uses Polly's synchronous `SynthesizeSpeech` with `SpeechMarkTypes=["word"]`, which requires the `neural` or `standard` engine (not `generative`) — see `common/polly.py`.

## Environment variables

| Name | Required | Default | Notes |
| --- | --- | --- | --- |
| `TTS_OUTPUT_BUCKET` | yes | — | S3 bucket for generated text/audio/record objects |
| `TTS_TEXT_S3_KEY_PREFIX` | no | `texts` | Key prefix for stored source text |
| `TTS_AUDIO_S3_KEY_PREFIX` | no | `audio` | Key prefix for generated audio |
| `TTS_RECORD_S3_KEY_PREFIX` | no | `records` | Key prefix for the stored record JSON (used by GET) |
| `TTS_URL_TTL_SECONDS` | no | `3600` | Presigned URL expiry for `text`/`audio` links |
| `TTS_DEFAULT_VOICE_ID` | no | `Joanna` | Overridable per-request via `voiceId` |
| `TTS_DEFAULT_ENGINE` | no | `neural` | Overridable per-request via `engine`; must support word speech marks |
| `TTS_DEFAULT_LANGUAGE_CODE` | no | `en-US` | Overridable per-request via `languageCode` |

## IAM

Each function's execution role needs:
- `polly:SynthesizeSpeech`
- `s3:PutObject` on `TTS_OUTPUT_BUCKET/*` (POST writes text, audio, record) and `s3:GetObject` (GET reads the record; both presign)

## API contract

**POST `/api/v1/text-to-speech`**
```json
{ "text": "Hello world", "voiceId": "Joanna", "languageCode": "en-US", "engine": "neural" }
```
→ `201`
```json
{
  "id": "6f1e2c...",
  "text_path": "",
  "text": "https://s3.../texts/6f1e2c....txt?...",
  "audio_path": "",
  "audio": "https://s3.../audio/6f1e2c....mp3?...",
  "timestamp": [
    { "id": 0, "s": 0, "e": 320, "block": "Hello" },
    { "id": 1, "s": 320, "e": 320, "block": "world" }
  ]
}
```

**GET `/api/v1/text-to-speech?id=6f1e2c...`**
→ `200` — same shape as the POST response, loaded back from the stored record.
→ `404` if `id` doesn't exist.

## Running locally

Requires AWS credentials (e.g. `aws sso login` or exported keys) with Polly + S3 access, since both handlers call real AWS services — there's no mocking here.

```bash
cd lambda
cp .env.example .env   # fill in TTS_OUTPUT_BUCKET (must already exist) and region
make run-post TEXT="Hello world"
make run-get ID=<id-from-the-post-response>
```

`make install` creates a `.venv` and installs `requirements.txt` automatically on first run. `.env` is sourced before each invoke. `make clean` removes the venv.
