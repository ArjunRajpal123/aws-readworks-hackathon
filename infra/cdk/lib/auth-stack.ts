import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { AppConfig, resourceName } from "./config";

export interface AuthStackProps extends cdk.StackProps {
  readonly config: AppConfig;
  /** Media bucket: the player's runtime auth config is written to sa/config/auth.json. */
  readonly mediaBucket: s3.Bucket;
  /** Public HTTPS origin of the player (CloudFront), e.g. "d123.cloudfront.net". */
  readonly webDomain: string;
}

/** The four Sound Along roles. Group precedence: lower wins when a user is in several. */
export const ROLES = ["admin", "teacher", "parent", "student"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Sign-in for Sound Along: a Cognito user pool with one group per role,
 * Cognito managed login (hosted sign-in page), and a public SPA app client
 * using the authorization code grant with PKCE.
 *
 * - No self sign-up: accounts are created by an admin (K-12: no open student
 *   registration). Email is the username.
 * - The player reads its auth settings at run time from
 *   sa/config/auth.json (written here into the media bucket, synced into the
 *   EKS pods), so the frontend image doesn't need rebuilding per environment
 *   and there's no stack dependency cycle with the frontend.
 * - API routes protect themselves with an HTTP API JWT authorizer
 *   (issuer = this pool, audience = this client) and check `cognito:groups`.
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly client: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config, mediaBucket, webDomain } = props;
    const isProd = config.environment === "prod";

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: resourceName(config, "cognito", "users"),
      // Managed login (v2) needs the Essentials plan; free up to 10k MAU.
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
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

    const origin = `https://${webDomain}`;
    const callbackUrls = [`${origin}/`, "http://localhost:5173/"];
    this.client = this.userPool.addClient("WebClient", {
      userPoolClientName: resourceName(config, "cognito", "web"),
      generateSecret: false, // public SPA client
      authFlows: { user: true, userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls,
        logoutUrls: callbackUrls,
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.hours(12),
    });

    const domain = this.userPool.addDomain("Domain", {
      cognitoDomain: {
        // Prefix domains are global: suffix the account id.
        domainPrefix: `${resourceName(config, "auth", "")}${cdk.Aws.ACCOUNT_ID}`.replace(/-+$/, ""),
      },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    // Managed login v2 shows nothing for a client until it has a branding style.
    new cognito.CfnManagedLoginBranding(this, "Branding", {
      userPoolId: this.userPool.userPoolId,
      clientId: this.client.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    const authConfig = {
      region: cdk.Aws.REGION,
      userPoolId: this.userPool.userPoolId,
      clientId: this.client.userPoolClientId,
      domain: `${domain.domainName}.auth.${cdk.Aws.REGION}.amazoncognito.com`,
      scopes: ["openid", "email", "profile"],
      roles: [...ROLES],
    };
    new s3deploy.BucketDeployment(this, "PlayerAuthConfig", {
      destinationBucket: mediaBucket,
      destinationKeyPrefix: "sa/config/",
      sources: [s3deploy.Source.jsonData("auth.json", authConfig)],
      prune: false, // never touch the rest of sa/
      retainOnDelete: false,
    });

    new cdk.CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, "WebClientId", { value: this.client.userPoolClientId });
    new cdk.CfnOutput(this, "LoginDomain", { value: authConfig.domain });
    new cdk.CfnOutput(this, "IssuerUrl", { value: this.userPool.userPoolProviderUrl });
  }
}
