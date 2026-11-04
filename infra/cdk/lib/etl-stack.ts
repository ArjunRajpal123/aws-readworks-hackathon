import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as path from "path";
import { AppConfig, resourceName } from "./config";
import { functionCode, LAMBDA_ROOT } from "./api-stack";

export interface EtlStackProps extends cdk.StackProps {
  readonly config: AppConfig;
  readonly mediaBucket: s3.Bucket;
  readonly referenceTable: dynamodb.Table;
}

/**
 * Cloud ETL: upload a passage JSON to s3://<media>/incoming/ and the
 * pipeline (etl/pipeline.py) runs in Lambda, writing the same sa/ files and
 * DynamoDB record as etl/run_aws.py.
 *
 *   S3 Object Created (incoming/*.json) -> EventBridge rule -> etl-run Lambda
 *   failures after retries -> SQS dead-letter queue
 *
 * Reserved concurrency throttles a bulk upload (backfill) to what Polly's
 * per-account TPS quota can absorb.
 */
export class EtlStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EtlStackProps) {
    super(scope, id, props);
    const { config, mediaBucket, referenceTable } = props;

    // Gets failed events both from EventBridge (delivery) and from Lambda
    // (function errors after its async retries).
    const dlq = new sqs.Queue(this, "EtlDlq", {
      queueName: resourceName(config, "sqs", "etl-dlq"),
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });

    const fn = new lambda.Function(this, "EtlRunFn", {
      functionName: resourceName(config, "lambda", "etl-run"),
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: "handler.handler",
      code: functionCode(path.join(LAMBDA_ROOT, "etl_run")),
      memorySize: 1024,
      // No API Gateway in front, so this can run well past 29 s: every voice
      // track is generated (2 per language, 2 Polly calls each).
      timeout: cdk.Duration.minutes(5),
      reservedConcurrentExecutions: 4,
      retryAttempts: 2,
      deadLetterQueue: dlq,
      environment: {
        TTS_MEDIA_BUCKET: mediaBucket.bucketName,
        TTS_REFERENCE_TABLE: referenceTable.tableName,
        TTS_S3_KEY_PREFIX: "sa/",
      },
      logGroup: new logs.LogGroup(this, "EtlRunLogs", {
        logGroupName: `/aws/lambda/${resourceName(config, "lambda", "etl-run")}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    mediaBucket.grantReadWrite(fn); // includes delete (move incoming/ -> processed/) and KMS
    referenceTable.grantWriteData(fn);
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["polly:SynthesizeSpeech"],
      resources: ["*"], // no resource-level permissions for SynthesizeSpeech
    }));
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["polly:PutLexicon", "polly:GetLexicon"],
      resources: [`arn:${cdk.Aws.PARTITION}:polly:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:lexicon/sa*`],
    }));

    new events.Rule(this, "IncomingPassageRule", {
      ruleName: resourceName(config, "events", "etl-incoming"),
      description: "Run the Sound Along pipeline for passage JSON uploaded to incoming/",
      eventPattern: {
        source: ["aws.s3"],
        detailType: ["Object Created"],
        detail: {
          bucket: { name: [mediaBucket.bucketName] },
          object: { key: [{ wildcard: "incoming/*.json" }] },
        },
      },
      targets: [new targets.LambdaFunction(fn, {
        retryAttempts: 2,
        maxEventAge: cdk.Duration.hours(2),
        deadLetterQueue: dlq,
      })],
    });

    new cdk.CfnOutput(this, "IncomingPrefix", {
      value: `s3://${mediaBucket.bucketName}/incoming/`,
      description: "Upload passage JSON here to run the pipeline in the cloud.",
    });
    new cdk.CfnOutput(this, "DeadLetterQueueUrl", { value: dlq.queueUrl });
  }
}
