# ReadWorks Sound Along — AWS CDK

AWS CDK 2.x (TypeScript) infrastructure, per `docs/SoundAlong-Kiro.md`
(region `us-west-2`). Everything runs in AWS: the ETL in Lambda, the player on EKS.

```
content team ── aws s3 cp passage.json ──► S3 incoming/ ──EventBridge──► etl-run Lambda ──► Polly
                                                                              │
                                              S3 sa/product, sa/audio ◄───────┘  + DynamoDB record
                                                     │ (sync sidecar, every 30 s)
student browser ──HTTPS──► CloudFront ──HTTP──► NLB ──► EKS pods (nginx + Vue build)
API clients ──► API Gateway /api/v1/text-to-speech ──► tts-post / tts-get Lambdas
```

## Stacks

| Stack | File | Contents |
| --- | --- | --- |
| `rg-readworks-bb-web` | `lib/web-stack.ts` | AWS Resource Group for everything tagged `Project=rg-readworks-bb`. |
| `rg-readworks-bb-storage` | `lib/storage-stack.ts` | S3 media bucket (private, KMS, versioned, EventBridge notifications on), DynamoDB reference table (PK `id`, `lang-index` GSI, PITR), KMS key. |
| `rg-readworks-bb-api` | `lib/api-stack.ts` | HTTP API `POST`/`GET /api/v1/text-to-speech` → `tts-post` (1024 MB) and `tts-get` (256 MB) Lambdas. |
| `rg-readworks-bb-etl` | `lib/etl-stack.ts` | Cloud ETL: EventBridge rule on `incoming/*.json` → `etl-run` Lambda (5 min, reserved concurrency 4) → SQS dead-letter queue. |
| `rg-readworks-bb-frontend` | `lib/frontend-stack.ts` | VPC (2 AZs, 1 NAT), EKS 1.35 with 1× t3.medium node, 2-pod Deployment (nginx + S3 sync sidecar, IRSA read-only on `sa/*`), NLB Service, CloudFront (HTTPS). |

In non-prod, data resources use `DESTROY` so `cdk destroy` cleans up; in `prod` they `RETAIN`.

## Prerequisites

1. Node 18+, Docker (builds the frontend image), AWS credentials in your shell.
2. CDK bootstrapped once per account/region: `npx cdk bootstrap`.

## Configure

```bash
cd infra/cdk
cp .env.example .env      # untracked; fill in values, then:
set -a && source .env && set +a
npm ci
```

> **Set `MEDIA_BUCKET_NAME` to the live bucket name before every deploy.**
> Without it the code falls back to `s3-readworks-bb-<env>-media`; if the
> deployed bucket has a different name (e.g. account-id suffix), CloudFormation
> will **replace the bucket and delete its contents**. Get the name with:
> `aws cloudformation describe-stacks --stack-name rg-readworks-bb-storage --query "Stacks[0].Outputs[?OutputKey=='MediaBucketName'].OutputValue" --output text`

## Deploy

Always diff first and check nothing stateful says `replace`:

```bash
npx cdk diff --all
npx cdk deploy --all
```

The frontend stack takes ~20 minutes the first time (EKS control plane + node).
Outputs:

| Output | Use |
| --- | --- |
| `rg-readworks-bb-frontend.HttpsUrl` | The player. Open a pipeline passage with `?m=<id>`, admin screen at `#admin`. |
| `rg-readworks-bb-frontend.KubeconfigCommand` | Run it, then `kubectl get pods,svc` (needs `EKS_ADMIN_ROLE_ARN` set at deploy). |
| `rg-readworks-bb-etl.IncomingPrefix` | Upload passage JSON here to generate audio. |
| `rg-readworks-bb-etl.DeadLetterQueueUrl` | Events that failed after retries. |
| `rg-readworks-bb-api.ApiUrl` | Text-to-speech API. |

## Run the ETL in the cloud

```bash
aws s3 cp etl/inputs/rws-e2-en.json s3://<media bucket>/incoming/
```

The `etl-run` Lambda generates every voice track for the passage's language,
writes `sa/product/<id>.soundAlong.json`, `sa/audio/<id>/…` and the DynamoDB
record, then moves the input to `processed/`. Invalid input goes to `failed/`
with an `.error.json`. Re-uploading an id regenerates it. The player picks up
new output within ~30 s (pod sync interval). Limit: 3,000 spoken characters
per passage (synchronous Polly).

## Cost

Run the `cost-estimate` skill (`.kiro/skills/cost-estimate/`). The EKS frontend
has fixed costs of roughly $165/month (control plane, node, NAT, NLB) even with no traffic.

## Clean up

```bash
npx cdk destroy rg-readworks-bb-frontend   # removes EKS/VPC/CloudFront, keeps data
npx cdk destroy --all                      # everything (non-prod deletes the bucket contents)
```
