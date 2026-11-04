#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { WebStack } from "../lib/web-stack";
import { StorageStack } from "../lib/storage-stack";
import { ApiStack } from "../lib/api-stack";
import { EtlStack } from "../lib/etl-stack";
import { FrontendStack } from "../lib/frontend-stack";

const config = loadConfig();

const app = new cdk.App();

const env: cdk.Environment = {
  account: config.account,
  region: config.region,
};

// Starting minimal: web stack (AWS Resource Group) + the text-to-speech API
// stack. More stacks (pipeline, etc.) are added back incrementally.
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

// Text-to-speech API: Lambda + API Gateway, reusing the storage stack's
// media bucket and reference table.
const api = new ApiStack(app, `${config.projectName}-api`, {
  env,
  config,
  mediaBucket: storage.mediaBucket,
  referenceTable: storage.referenceTable,
  description: "ReadWorks Sound Along — text-to-speech API (Lambda + API Gateway).",
});

// Cloud ETL: passage JSON uploaded to incoming/ -> EventBridge -> pipeline Lambda.
const etl = new EtlStack(app, `${config.projectName}-etl`, {
  env,
  config,
  mediaBucket: storage.mediaBucket,
  referenceTable: storage.referenceTable,
  description: "ReadWorks Sound Along — cloud ETL (S3 incoming/ -> EventBridge -> Lambda).",
});
// Vue player on EKS (nginx pod + S3 sync sidecar behind an NLB).
const frontend = new FrontendStack(app, `${config.projectName}-frontend`, {
  env,
  config,
  mediaBucket: storage.mediaBucket,
  description: "ReadWorks Sound Along — web player on Amazon EKS.",
});
// Tag everything so the AWS Resource Group (rg-readworks-bb) captures it.
for (const stack of [web, storage, api, etl, frontend]) {
  cdk.Tags.of(stack).add("Project", config.projectName);
  cdk.Tags.of(stack).add("Environment", config.environment);
  cdk.Tags.of(stack).add("ManagedBy", "cdk");
}
