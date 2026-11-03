# ReadWorks Sound Along — AWS CDK

AWS CDK 2.x (TypeScript) infrastructure, per `docs/SoundAlong-Kiro.md`
(region `us-west-2`). Built incrementally.

## Current state

Built incrementally. Current stacks:

| Stack | Logical id | Contents |
| --- | --- | --- |
| `rg-readworks-bb-web` | `WebStack` | AWS Resource Group (`rg-readworks-bb`). |
| `rg-readworks-bb-storage` | `StorageStack` | ETL storage: DynamoDB reference table + private S3 media bucket + KMS key. |

The Resource Group groups every resource tagged `Project=rg-readworks-bb`, so
as more resources are added they show up together automatically. ("Resource
group" is Azure terminology; the AWS equivalent is this tag-based group.)

### Storage stack (for the ETL pipeline)

| Resource | Name | Notes |
| --- | --- | --- |
| DynamoDB table | `rg-readworks-bb-<env>-reference` | PK `id`; `lang-index` GSI; on-demand; KMS; point-in-time recovery. |
| S3 bucket | `rg-readworks-bb-<env>-media-<account>` | Audio + text blobs. All public access blocked, KMS, SSL enforced, versioned. |
| KMS key | `alias/rg-readworks-bb-<env>-storage` | Shared by the table and bucket; rotation on. |

Security follows the baseline in `docs/SoundAlong-Kiro.md`: no public exposure
(S3 is reachable only via CloudFront OAC, added later), KMS on the media
bucket, encryption + PITR on the table
. In non-prod the resources use
`DESTROY` so `cdk destroy` cleans up; in `prod` they `RETAIN`.

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

Deploy just the ETL storage stack:

```bash
npx cdk de

npx cdk deploy rg-readworks-bb-storage
```

## Clean up

```bash
npx cdk destroy --all
```
