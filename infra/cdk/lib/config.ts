/**
 * Centralized configuration, sourced from environment variables so that
 * nothing account- or environment-specific is committed to this public repo.
 *
 * Deploy-time AWS account/region come from the standard CDK/AWS resolution
 * (CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION, i.e. your active AWS profile).
 *
 * Pipeline source settings are provided via:
 *   GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, GITHUB_CONNECTION_ARN
 */

export interface AppConfig {
  /** Project name / prefix. Mirrors the requested "rg-readworks-bb". */
  readonly projectName: string;
  /** Environment label (dev/staging/prod) used in names and tags. */
  readonly environment: string;
  /** Target region. The design doc targets us-west-2. */
  readonly region: string;
  /** Account id for the deploy, resolved from the CLI environment. */
  readonly account?: string;

  readonly github: {
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
    /** ARN of an existing, authorized CodeConnections (GitHub) connection. */
    readonly connectionArn: string;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set it (see infra/cdk/.env.example) before running cdk synth/deploy.`
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

export function loadConfig(): AppConfig {
  return {
    projectName: optional("PROJECT_NAME", "rg-readworks-bb"),
    environment: optional("ENVIRONMENT", "dev"),
    region: optional("AWS_REGION", optional("CDK_DEFAULT_REGION", "us-west-2")),
    account: process.env.CDK_DEFAULT_ACCOUNT,
    github: {
      owner: required("GITHUB_OWNER"),
      repo: required("GITHUB_REPO"),
      branch: optional("GITHUB_BRANCH", "main"),
      connectionArn: required("GITHUB_CONNECTION_ARN"),
    },
  };
}
