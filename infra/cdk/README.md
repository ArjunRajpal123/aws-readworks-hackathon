# ReadWorks Sound Along — AWS CDK

AWS CDK 2.x (TypeScript) infrastructure, per `docs/SoundAlong-Kiro.md`
(region `us-west-2`). Built incrementally.

## Current state

| Stack | Logical id | Contents |
| --- | --- | --- |
| `rg-readworks-bb-web` | `WebStack` | AWS Resource Group (`rg-readworks-bb`). |
| `rg-readworks-bb-api` | `ApiStack` | S3 bucket + the two `/api/v1/text-to-speech` Lambda functions (source: `../../lambda`) behind an API Gateway HTTP API. |

The Resource Group groups every resource tagged `Project=rg-readworks-bb`, so
as more resources are added they show up together automatically. ("Resource
group" is Azure terminology; the AWS equivalent is this tag-based group.)

### `ApiStack`

- `TtsBucket` — private S3 bucket (`${PROJECT_NAME}-${ENVIRONMENT}-tts`) holding
  generated text, audio and the per-request record JSON.
- `TextToSpeechPostFn` / `TextToSpeechGetFn` — Python 3.12 Lambda functions
  packaged from `lambda/text_to_speech_post` and `lambda/text_to_speech_get`,
  each bundled with a copy of `lambda/common` (no Docker, no pip install —
  boto3 ships with the Lambda runtime). See `lambda/README.md` for the
  handler contract.
- `TtsHttpApi` — API Gateway HTTP API routing `POST`/`GET`
  `/api/v1/text-to-speech` to the two functions. The invoke URL is printed as
  the `ApiUrl` stack output after deploy.

Lambda environment variables (`TTS_OUTPUT_BUCKET`, `TTS_DEFAULT_VOICE_ID`,
etc.) are set directly by the CDK stack, not by `infra/cdk/.env` — those
names must stay in sync with what `lambda/common/polly.py` and
`lambda/common/s3_store.py` read. `lambda/.env` / `lambda/Makefile` are only
for invoking the handlers locally without going through API Gateway.

## Prerequisites

1. Node 18+ and AWS credentials in your shell (profile / SSO / `AWS_*` vars,
   or the instance role in this sandbox).
2. CDK bootstrapped once per account/region: `npx cdk bootstrap`.

## Usage

```bash
cd infra/cdk

cp .env.example .env            # optional overrides
set -a && source .env && set +a

npm ci
npx cdk synth
npx cdk deploy --all
```

## Clean up

```bash
npx cdk destroy --all
```
