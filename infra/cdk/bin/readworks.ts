#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { PipelineStack } from "../lib/pipeline-stack";
import { WebStack } from "../lib/web-stack";

const config = loadConfig();

const app = new cdk.App();

const env: cdk.Environment = {
  account: config.account,
  region: config.region,
};

// Two stacks, as the design doc specifies: `pipeline` and `web`.
const pipeline = new PipelineStack(app, `${config.projectName}-pipeline`, {
  env,
  config,
  description: "ReadWorks Sound Along — CI/CD pipeline (validation stack).",
});

const web = new WebStack(app, `${config.projectName}-web`, {
  env,
  config,
  description: "ReadWorks Sound Along — web/content delivery (validation stack).",
});

// Tag everything so the AWS Resource Group (rg-readworks-bb) captures it all.
for (const stack of [pipeline, web]) {
  cdk.Tags.of(stack).add("Project", config.projectName);
  cdk.Tags.of(stack).add("Environment", config.environment);
  cdk.Tags.of(stack).add("ManagedBy", "cdk");
}
