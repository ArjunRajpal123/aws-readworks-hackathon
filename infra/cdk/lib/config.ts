/**
 * Centralized configuration, sourced from environment variables so that
 * nothing account- or environment-specific is committed to this public repo.
 *
 * Deploy-time AWS account/region come from the standard CDK/AWS resolution
 * (CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION, i.e. your active AWS profile).
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
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

/**
 * Resource naming convention:
 *
 *   <resourceType>-<base>-<env>[-<suffix>]
 *
 * where <resourceType> is a short service prefix (s3, dynamodb, lambda, ...),
 * <base> is the project base (readworks-bb), and <env> is dev/staging/prod.
 * No account id or random suffix is appended.
 *
 * Example: resourceName(config, "s3", "media") -> "s3-readworks-bb-dev-media"
 *
 * `base` is derived from projectName by stripping any leading "rg-" so the
 * resource-type prefix replaces it (rg-readworks-bb -> readworks-bb).
 */
export function resourceName(
  config: AppConfig,
  resourceType: string,
  suffix?: string
): string {
  const base = config.projectName.replace(/^rg-/, "");
  const parts = [resourceType, base, config.environment];
  if (suffix) {
    parts.push(suffix);
  }
  return parts.join("-");
}

export function loadConfig(): AppConfig {
  return {
    projectName: optional("PROJECT_NAME", "rg-readworks-bb"),
    environment: optional("ENVIRONMENT", "dev"),
    region: optional("AWS_REGION", optional("CDK_DEFAULT_REGION", "us-west-2")),
    account: process.env.CDK_DEFAULT_ACCOUNT,
  };
}
