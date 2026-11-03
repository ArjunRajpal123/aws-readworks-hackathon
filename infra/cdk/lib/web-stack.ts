import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as resourcegroups from "aws-cdk-lib/aws-resourcegroups";
import { AppConfig } from "./config";

export interface WebStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/**
 * Web / content-delivery stack. For this validation pass it provisions:
 *  - the AWS Resource Group (the real AWS equivalent of "rg-readworks-bb")
 *  - the passage store S3 bucket (concrete workload resource from design.md)
 *
 * CloudFront, the Vue player hosting, etc. are added as the project grows.
 */
export class WebStack extends cdk.Stack {
  public readonly passagesBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const { config } = props;
    const prefix = `${config.projectName}-${config.environment}`;

    // AWS Resource Group: groups every resource tagged Project = projectName.
    new resourcegroups.CfnGroup(this, "ProjectResourceGroup", {
      name: config.projectName,
      description: "Resource group for the ReadWorks Sound Along project.",
      resourceQuery: {
        type: "TAG_FILTERS_1_0",
        query: {
          resourceTypeFilters: ["AWS::AllSupported"],
          tagFilters: [{ key: "Project", values: [config.projectName] }],
        },
      },
    });

    // Passage store: private, encrypted, versioned.
    this.passagesBucket = new s3.Bucket(this, "PassagesBucket", {
      bucketName: `${prefix}-passages-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cdk.CfnOutput(this, "PassagesBucketName", {
      value: this.passagesBucket.bucketName,
      description: "Passage store S3 bucket.",
    });
  }
}
