# ReadWorks Sound Along — AWS CDK

AWS CDK 2.x (TypeScript) infrastructure, per `docs/SoundAlong-Kiro.md`
(region `us-west-2`). Built incrementally.

## Current state

Minimal on purpose. One stack, one resource:

| Stack | Logical id | Contents |
| --- | --- | --- |
| `rg-readworks-bb-web` | `WebStack` | AWS Resource Group (`rg-readworks-bb`). |

The Resource Group groups every resource tagged `Project=rg-readworks-bb`, so
as more resources are added they show up together automatically. ("Resource
group" is Azure terminology; the AWS equivalent is this tag-based group.)

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
