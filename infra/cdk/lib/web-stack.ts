import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as resourcegroups from "aws-cdk-lib/aws-resourcegroups";
import { AppConfig } from "./config";

export interface WebStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/**
 * Web / content-delivery stack.
 *
 * Intentionally minimal for now: it provisions only the AWS Resource Group
 * (the real AWS equivalent of "rg-readworks-bb"), which groups every resource
 * tagged Project = projectName. Workload resources (S3, CloudFront, the Vue
 * player, etc.) are added incrementally.
 */
export class WebStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const { config } = props;

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
  }
}
