# Pipeline Setup — GitHub ↔ AWS Connection

How to connect the GitHub repo to AWS and deploy the CI/CD pipeline for the
ReadWorks Sound Along project. Region is `us-west-2`, account `639828717145`.

The one piece that can't be fully scripted is the **CodeConnections** GitHub
connection — it needs a one-time OAuth handshake in the AWS console. Everything
after that is CDK.

---

## 1. Create the GitHub connection (CodeConnections)

CodeConnections (formerly "CodeStar Connections") is what lets CodePipeline
pull from GitHub securely, without storing a personal access token.

### Option A — Console

1. Set the region selector (top-right) to **US West (Oregon) / us-west-2**.
   Connections are regional; the wrong region shows an empty list.
2. Open **CodePipeline** (search for it in the top bar). In the left nav,
   scroll to the bottom: **Settings → Connections**. (There is no standalone
   "Developer Tools" service — Connections lives in the shared nav used by
   CodePipeline / CodeBuild / CodeDeploy.)

   Direct link:
   `https://us-west-2.console.aws.amazon.com/codesuite/settings/connections?region=us-west-2`
3. **Create connection** → provider **GitHub** → give it a name
   (e.g. `aws-readwork-github`).
4. Click **Connect to GitHub** → authorize the *AWS Connector for GitHub* app →
   grant it access to the `aws-readworks-hackathon` repo (or all repos).
5. The status must become **Available**. If it says **Pending**, the OAuth
   step was not finished and the pipeline's Source stage will fail.

### Option B — CLI (still needs the console to finish auth)

```bash
aws codeconnections create-connection \
  --provider-type GitHub \
  --connection-name aws-readwork-github \
  --region us-west-2
```

This returns a `ConnectionArn` with status **PENDING**. Finish authorization by
opening the connection in the console and clicking **Update pending
connection**:

```
https://us-west-2.console.aws.amazon.com/codesuite/settings/connections/<paste-arn>?region=us-west-2
```

### Get the connection ARN / check status

```bash
# list all connections and their status
aws codeconnections list-connections --region us-west-2 --output table

# check one connection's status
aws codeconnections get-connection \
  --connection-arn "arn:aws:codeconnections:us-west-2:639828717145:connection/<uuid>" \
  --region us-west-2 \
  --query 'Connection.ConnectionStatus'
```

Only use a connection whose status is **AVAILABLE**. The ARN looks like:

```
arn:aws:codeconnections:us-west-2:639828717145:connection/4810b33c-d3d6-479e-b424-c91c68ad7cbb
```

The **UUID** is the part after `connection/`. You can pass the whole ARN; the
CDK config reads `GITHUB_CONNECTION_ARN` directly.

---

## 2. Configure environment variables

The repo is public, so nothing account- or source-specific is committed. The
CDK app reads everything from env vars. Copy the template and fill it in:

```bash
cd infra/cdk
cp .env.example .env
```

Edit `infra/cdk/.env`:

```bash
export PROJECT_NAME="rg-readworks-bb"
export ENVIRONMENT="dev"
export AWS_REGION="us-west-2"

export GITHUB_OWNER="ArjunRajpal123"
export GITHUB_REPO="aws-readworks-hackathon"
export GITHUB_BRANCH="vini-dev"   # the branch the pipeline should track
export GITHUB_CONNECTION_ARN="arn:aws:codeconnections:us-west-2:639828717145:connection/4810b33c-d3d6-479e-b424-c91c68ad7cbb"
```

> `.env` is gitignored — keep real values only there, never in `.env.example`.
> Note: the pipeline stack / these GitHub vars only apply once the pipeline
> stack is part of the CDK app. The current app is trimmed to the Resource
> Group; re-add the pipeline stack before these take effect.

Load them into the current shell before any `cdk` command:

```bash
set -a && source .env && set +a
```

AWS credentials themselves come from your normal AWS auth (profile, SSO, or the
EC2 instance role in this sandbox) — not from these variables. Verify with:

```bash
aws sts get-caller-identity
```

---

## 3. Deploy

```bash
cd infra/cdk
set -a && source .env && set +a

npm ci
npx cdk bootstrap aws://639828717145/us-west-2   # once per account/region
npx cdk synth                                     # sanity check
npx cdk deploy --all --require-approval never
```

`cdk deploy` creates the pipeline. The pipeline runs **automatically** on
creation and again on every push to the branch in `GITHUB_BRANCH`.

---

## 4. Trigger and watch a run

A manual run is only needed for an on-demand re-run (the first run is automatic
after deploy):

```bash
aws codepipeline start-pipeline-execution \
  --name rg-readworks-bb-dev-pipeline \
  --region us-west-2
```

Watch progress:

```bash
# per-stage status
aws codepipeline get-pipeline-state \
  --name rg-readworks-bb-dev-pipeline \
  --region us-west-2 \
  --query 'stageStates[].{Stage:stageName,Status:latestExecution.status}' \
  --output table

# recent executions
aws codepipeline list-pipeline-executions \
  --pipeline-name rg-readworks-bb-dev-pipeline \
  --region us-west-2 --max-items 5 \
  --query 'pipelineExecutionSummaries[].{Id:pipelineExecutionId,Status:status}' \
  --output table
```

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `PipelineNotFoundException` on `start-pipeline-execution` | Pipeline not deployed yet | Run `cdk deploy` first; the pipeline only exists after deploy |
| Source stage fails immediately | Connection still **PENDING** | Finish the OAuth step so the connection is **AVAILABLE** (step 1) |
| Connections list is empty in console | Wrong region | Switch region selector to **us-west-2** |
| `Missing required environment variable GITHUB_...` on synth | `.env` not sourced in this shell | `set -a && source .env && set +a` |
| Can't find "Connections" in console | It's under a Code* service's left nav, not its own service | Open CodePipeline, then **Settings → Connections** |

---

## What gets created

| Resource | Purpose |
| --- | --- |
| CodePipeline (`rg-readworks-bb-dev-pipeline`) | Source → Build pipeline |
| CodeBuild project (`rg-readworks-bb-dev-build`) | Runs the build step |
| Artifact S3 bucket | Passes source between pipeline stages (CDK-created) |
| KMS key | Encrypts pipeline artifacts (CDK-created) |

The GitHub connection itself is created once (step 1) and reused; it is **not**
managed by CDK.
