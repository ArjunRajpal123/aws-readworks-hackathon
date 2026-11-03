#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { WebStack } from "../lib/web-stack";
import { StorageStack } from "../lib/storage-stack";

const config = loadConfig();

const app = new cdk.App();

const env: cdk.Environment = {
  account: config.account,
  region: config.region,
};

// Starting minimal: only the web stack (AWS Resource Group). More stacks
// (pipeline, etc.) are added back incrementally.
const web = new WebStack(app, `${config.projectName}-web`, {
  env,
  config,
  description: "ReadWorks Sound Along — web stack (Resource Group only, for now).",
});

// Storage layer for the ETL pipeline: DynamoDB reference db + S3 media bucket.
const storage = new StorageStack(app, `${config.projectName}-storage`, {
  env,
  config,
  description: "ReadWorks Sound Along — ETL storage (DynamoDB + S3, private).",
});

// Tag everything so the AWS Resource Group (rg-readworks-bb) captures it.
for (const stack of [web, storage]) {
  cdk.Tags.of(stack).add("Project", config.projectName);
  cdk.Tags.of(stack).add("Environment", config.environment);
  cdk.Tags.of(stack).add("ManagedBy", "cdk");
}
