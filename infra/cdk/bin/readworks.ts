#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { WebStack } from "../lib/web-stack";

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

// Tag everything so the AWS Resource Group (rg-readworks-bb) captures it.
cdk.Tags.of(web).add("Project", config.projectName);
cdk.Tags.of(web).add("Environment", config.environment);
cdk.Tags.of(web).add("ManagedBy", "cdk");
