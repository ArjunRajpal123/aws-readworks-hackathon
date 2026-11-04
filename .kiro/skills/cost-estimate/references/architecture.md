# What gets priced

The calculator splits resources into two scenarios. Update this file and `scripts/estimate_cost.py` together when the CDK or the design changes.

## `current`: deployed by infra/cdk today

| Resource | Config | Source |
|---|---|---|
| S3 media bucket | SSE-KMS with bucket key, versioned, noncurrent versions expire after 90 days, EventBridge notifications on | `infra/cdk/lib/storage-stack.ts` |
| DynamoDB reference table | On-demand, CMK, PITR, `lang-index` GSI with ALL projection (doubles writes) | `storage-stack.ts` |
| KMS CMK | 1 key, rotation on | `storage-stack.ts` |
| Lambda `etl-run` | Python 3.13, 1024 MB, 5 min, reserved concurrency 4; triggered by `incoming/*.json` via EventBridge (free for S3 events) | `infra/cdk/lib/etl-stack.ts` |
| SQS DLQ | Only receives failures | `etl-stack.ts` |
| Lambda `tts-post` / `tts-get` + HTTP API | 1024 / 256 MB. Not on the playback path, so priced only via `api_current` | `infra/cdk/lib/api-stack.ts` |
| EKS frontend | EKS 1.35 control plane, 1x t3.medium node (20 GB), 1 NAT gateway, internet-facing NLB, 2 nginx pods with an S3 sync sidecar (LIST every 30 s) | `infra/cdk/lib/frontend-stack.ts` |
| CloudFront | HTTPS in front of the NLB; page and `sa/` not cached, so all play traffic also crosses the NLB | `frontend-stack.ts` |
| Polly Neural | 2 voices per language, 2 billed calls per track (MP3 + speech marks) | `etl/voices.json`, `etl/audio.py` |
| Web stack | Resource Group only (free) | `infra/cdk/lib/web-stack.ts` |

Playback is modelled as browser → CloudFront → NLB → pods. The EKS fixed costs (about $165/month) apply even with zero traffic.

## `target`: full architecture in docs/SoundAlong-Kiro.md

None of this is built yet. It adds:
- S3 → EventBridge → Step Functions (Standard).
- Tokenizer, QA, Write and Word Stops Lambdas.
- Polly **generative**: 1 voice per language, computerized passages only.
- WhisperX on ECS Fargate (CPU).
- Bedrock Word Stops (model not chosen; priced as Claude Haiku 4.5).
- SQS backfill queue and DLQ, plus an SNS daily report.
- CloudFront over S3, which serves JSON, audio, timing and the Vue app.
- t3.small EC2 running the Express content API.
- CloudWatch alarms and a dashboard.
- Secrets Manager and GuardDuty.
- Phase 4 Firehose → S3 → Athena analytics.
- CodePipeline V2 + CodeBuild.

## Not priced (call these out in reports)
- **Free Tier**: always-free allowances are not applied. These include Lambda 1M requests / 400k GB-s, CloudFront 1 TB, and S3 100 GB egress. CloudFront flat-rate plans are also not modelled.
- **CloudTrail**: the first management-event trail is free. Data events are not modelled.
- **GuardDuty**: a flat placeholder in `assumptions.json`.
- **Human-audio storage**: these files already live in ReadWorks storage.
- **AWS Batch GPU alignment**: an alternative to Fargate if CPU is too slow.
- **ReadWorks-side costs**: people, support plans, Savings Plans or EDP discounts.
- **Spanish versions**: only priced if `catalog.spanish_extra_chars` is set.
