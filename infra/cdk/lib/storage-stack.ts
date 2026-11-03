import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";
import { AppConfig, resourceName } from "./config";

export interface StorageStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/**
 * Storage stack for the ETL pipeline.
 *
 *  - DynamoDB "reference db": passage metadata + timing references.
 *  - S3 "media bucket": audio (mp3) and text blobs.
 *
 * Follows the security baseline in docs/SoundAlong-Kiro.md:
 * private S3 (no public exposure, CloudFront OAC only), KMS on the media
 * bucket, encryption + point-in-time recovery on the table, SSL enforced.
 */
export class StorageStack extends cdk.Stack {
  public readonly mediaBucket: s3.Bucket;
  public readonly referenceTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { config } = props;
    // Dev/sandbox tears down cleanly; prod retains data.
    const isProd = config.environment === "prod";
    const removalPolicy = isProd
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // ---------------------------------------------------------------------
    // Customer-managed KMS key shared by the bucket and table.
    // ---------------------------------------------------------------------
    const key = new kms.Key(this, "StorageKey", {
      alias: `alias/${resourceName(config, "kms", "storage")}`,
      description: "Encrypts the ReadWorks ETL media bucket and reference table.",
      enableKeyRotation: true,
      removalPolicy,
    });

    // ---------------------------------------------------------------------
    // S3 media bucket — audio + text blobs. No public exposure.
    // ---------------------------------------------------------------------
    this.mediaBucket = new s3.Bucket(this, "MediaBucket", {
      bucketName: resourceName(config, "s3", "media"),
      // Private: all public access blocked. Reads go through CloudFront OAC.
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      // KMS on the media bucket, per the security baseline.
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: key,
      bucketKeyEnabled: true,
      enforceSSL: true,
      versioned: true,
      removalPolicy,
      autoDeleteObjects: !isProd,
      lifecycleRules: [
        {
          // Keep storage lean: expire old versions after 90 days.
          noncurrentVersionExpiration: cdk.Duration.days(90),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    // ---------------------------------------------------------------------
    // DynamoDB reference table — passage metadata / timing references.
    // Partition key `id` matches the passage id in the data contract.
    // ---------------------------------------------------------------------
    this.referenceTable = new dynamodb.Table(this, "ReferenceTable", {
      tableName: resourceName(config, "dynamodb", "reference"),
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      // On-demand: ETL load is bursty and hard to forecast.
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: key,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy,
    });

    // GSI to query passages by language (e.g. backfill the Spanish set).
    this.referenceTable.addGlobalSecondaryIndex({
      indexName: "lang-index",
      partitionKey: { name: "lang", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ---------------------------------------------------------------------
    // Outputs — the API stack and the ETL app reference these.
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, "MediaBucketName", {
      value: this.mediaBucket.bucketName,
      description: "S3 media bucket (audio + text blobs).",
    });
    new cdk.CfnOutput(this, "ReferenceTableName", {
      value: this.referenceTable.tableName,
      description: "DynamoDB reference table.",
    });
    new cdk.CfnOutput(this, "StorageKeyArn", {
      value: key.keyArn,
      description: "KMS key protecting the media bucket and reference table.",
    });
  }
}
