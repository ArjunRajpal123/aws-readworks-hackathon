# Lambda functions

Two Lambda functions backing `/api/v1/text-to-speech` behind API Gateway (Lambda-proxy integration):

| Method | Function | Handler | Purpose |
| --- | --- | --- | --- |
| POST | `text_to_speech_post` | `handler.handler` | Starts an async Polly `StartSpeechSynthesisTask` and returns `taskId` |
| GET | `text_to_speech_get` | `handler.handler` | Polls `GetSpeechSynthesisTask` by `?taskId=`; returns a presigned audio URL once `completed` |

`common/` holds shared Polly and response helpers; package it alongside each handler when zipping/deploying (each function needs its own copy of `common/`).

## Environment variables

| Name | Required | Default | Notes |
| --- | --- | --- | --- |
| `TTS_OUTPUT_BUCKET` | yes (POST) | — | S3 bucket Polly writes synthesized audio to |
| `TTS_OUTPUT_S3_KEY_PREFIX` | no | `tts` | Key prefix for generated audio objects |
| `TTS_DEFAULT_VOICE_ID` | no | `Joanna` | Overridable per-request via `voiceId` |
| `TTS_DEFAULT_ENGINE` | no | `generative` | Overridable per-request via `engine` |
| `TTS_DEFAULT_LANGUAGE_CODE` | no | `en-US` | Overridable per-request via `languageCode` |

## IAM

Each function's execution role needs:
- `polly:StartSpeechSynthesisTask` / `polly:GetSpeechSynthesisTask`
- `s3:PutObject` on `TTS_OUTPUT_BUCKET/*` (Polly writes using the function's identity when `OutputS3BucketName` is set) and `s3:GetObject` for presigning in the GET function

## API contract

**POST `/api/v1/text-to-speech`**
```json
{ "text": "Hello world", "voiceId": "Joanna", "languageCode": "en-US", "engine": "generative" }
```
→ `202`
```json
{ "taskId": "abc123", "status": "scheduled", "voiceId": "Joanna", "outputUri": "https://s3..." }
```

**GET `/api/v1/text-to-speech?taskId=abc123`**
→ `200`
```json
{ "taskId": "abc123", "status": "completed", "audioUrl": "https://presigned-url..." }
```
