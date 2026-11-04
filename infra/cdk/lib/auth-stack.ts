import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { AppConfig, resourceName } from "./config";

export interface AuthStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/** The four Sound Along roles. Group precedence: lower wins when a user is in several. */
export const ROLES = ["admin", "teacher", "parent", "student"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Sign-in for Sound Along: a Cognito user pool with one group per role and
 * a public app client used by the player's own sign-in page
 * (frontend/src/auth.js, styled like the rest of the app).
 *
 * - No self sign-up: an admin creates accounts (K-12: no open student
 *   registration). Email is the username. New accounts get a temporary
 *   password and must set their own on first sign-in.
 * - `custom:personId` links an account to a person in the app (e.g.
 *   t-okafor, p-chen, s-maya), so a teacher sees their class, a parent their
 *   children and a student their own reading. Admins don't need one.
 * - Only admins can change `custom:personId` (the client can read, not write it).
 * - The player gets its settings from config.js, written in the pod from
 *   env vars (FrontendStack), like the API URL.
 * - The API checks tokens with an HTTP API JWT authorizer (issuer = this
 *   pool, audience = this client) and `cognito:groups` in the Lambda.
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly client: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;
    const isProd = config.environment === "prod";

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: resourceName(config, "cognito", "users"),
      featurePlan: cognito.FeaturePlan.LITE, // free tier; no hosted UI needed
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      customAttributes: {
        personId: new cognito.StringAttribute({ minLen: 1, maxLen: 64, mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deletionProtection: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    ROLES.forEach((role, precedence) => {
      new cognito.CfnUserPoolGroup(this, `Group-${role}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: role,
        precedence,
        description: `Sound Along ${role}`,
      });
    });

    const readable = new cognito.ClientAttributes()
      .withStandardAttributes({ email: true, emailVerified: true, givenName: true, familyName: true })
      .withCustomAttributes("personId");
    // Cognito requires every required attribute (email) to be writable by the client.
    const writable = new cognito.ClientAttributes().withStandardAttributes({ email: true, givenName: true, familyName: true });

    this.client = this.userPool.addClient("WebClient", {
      userPoolClientName: resourceName(config, "cognito", "web"),
      generateSecret: false, // public browser client
      // USER_PASSWORD_AUTH from the app's own sign-in page (over HTTPS to Cognito).
      authFlows: { userPassword: true, userSrp: true },
      readAttributes: readable,
      writeAttributes: writable,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.hours(12),
    });

    new cdk.CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, "WebClientId", { value: this.client.userPoolClientId });
    new cdk.CfnOutput(this, "IssuerUrl", { value: this.userPool.userPoolProviderUrl });
  }
}
