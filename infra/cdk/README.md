# ReadWorks Sound Along — AWS CDK (validation stacks)

AWS CDK 2.x (TypeScript) infrastructure, per `docs/SoundAlong-Kiro.md`
(region `us-west-2`, two stacks: `pipeline` and `web`). This first pass is
intentionally minimal — enough to validate that we can deploy and run a
CI/CD pipeline. All account/source-specific values come from environment
variables so nothing sensitive is committed to this public repo.

## Stacks

| Stack | Logical id | Contents |
| --- | --- | --- |
| `rg-readworks-bb-web` | `WebStack` | AWS Resource Group (`rg-readworks-bb`) + passage store S3 bucket (private, encrypted, versioned). |
| `rg-readworks-bb-pipeline` | `PipelineStack` | CodePipeline (Source → Build) from GitHub via CodeConnections, running a CodeBuild validation build. |

Every resource is tagged `Project=rg-readworks-bb`, so the AWS Resource Group
captures the whole stack. ("Resource group" is Azure terminology; the AWS
equivalent is a tag-based Resource Group, which is what this creates.)

## Prerequisites

1. Node 18+ and AWS credentials in your shell (profile / SSO / `AWS_*` vars).
2. A GitHub **CodeConnections** connection, created and authorized once in the
   console: *Developer Tools → Settings → Connections*. Copy its ARN.
3. CDK bootstrapped in the target account/region once: `npx cdk bootstrap`.

## Usage

```bash
cd infra/cdk

cp .env.example .env            # fill in GITHUB_* values
set -a && source .env && set +a

npm ci
npx cdk bootstrap               # first time per account/region
npx cdk synth
npx cdk deploy --all
```

## Why env vars

The repo is public. `lib/config.ts` reads every input from environment
variables (`GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`,
`GITHUB_CONNECTION_ARN`, optional `PROJECT_NAME` / `ENVIRONMENT` /
`AWS_REGION`). `.env` is gitignored; only `.env.example` is tracked.

## Clean up

```bash
npx cdk destroy --all
```

The passages bucket uses `RETAIN`, so it survives `destroy`; delete it
manually if you want it gone.
