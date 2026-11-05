import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as fs from "fs";
import * as path from "path";
import { AppConfig, resourceName } from "./config";

export interface ApiStackProps extends cdk.StackProps {
  readonly config: AppConfig;
  /** Shared media bucket from StorageStack — audio/text blobs land here. */
  readonly mediaBucket: s3.Bucket;
  /** Shared reference table from StorageStack — one item per request, PK `id`. */
  readonly referenceTable: dynamodb.Table;
}

// ../../lambda relative to this file (infra/cdk/lib/api-stack.ts -> lambda/)
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
export const LAMBDA_ROOT = path.join(REPO_ROOT, "lambda");
const COMMON_DIR = path.join(LAMBDA_ROOT, "common");
const ETL_DIR = path.join(REPO_ROOT, "etl");

/**
 * The Sound Along pipeline modules from etl/ that the API runs. They use
 * flat imports (`from tokenizer import ...`) and voices.py resolves
 * voices.json / lexicons/ relative to itself, so they are copied to the
 * bundle root unchanged. CLI runners, review/audition tools, inputs and
 * tests are not shipped.
 */
const ETL_RUNTIME_FILES = [
  "audio.py",
  "mp3duration.py",
  "pipeline.py",
  "ssml.py",
  "storage.py",
  "tokenizer.py",
  "voices.py",
  "voices.json",
  "lexicons",
];

/**
 * Each function's asset bundle is the function's own directory plus a copy
 * of the shared `lambda/common` package and the etl/ pipeline modules, laid
 * out like local dev (see lambda/scripts/invoke_local.py) so `from common.x
 * import y` and `from pipeline import run` resolve the same way at runtime.
 * No Docker required: the pipeline only needs boto3/botocore, which ship
 * with the Lambda Python runtime, so this is a plain file copy.
 */
export function functionCode(functionDir: string, withEtl = true): lambda.Code {
  return lambda.Code.fromAsset(functionDir, {
    // Default asset hashing only looks at `functionDir`, but tryBundle below
    // also pulls in lambda/common from outside it -- hash the bundled
    // OUTPUT instead, so edits to common/ actually trigger a redeploy.
    assetHashType: cdk.AssetHashType.OUTPUT,
    bundling: {
      image: lambda.Runtime.PYTHON_3_13.bundlingImage,
      local: {
        tryBundle(outputDir: string): boolean {
          const skipPycache = (src: string) => !src.includes("__pycache__");
          fs.cpSync(functionDir, outputDir, { recursive: true, filter: skipPycache });
          fs.cpSync(COMMON_DIR, path.join(outputDir, "common"), {
            recursive: true,
            filter: skipPycache,
          });
          // The data API doesn't run the pipeline, so it skips the etl modules.
          if (withEtl) {
            for (const name of ETL_RUNTIME_FILES) {
              fs.cpSync(path.join(ETL_DIR, name), path.join(outputDir, name), {
                recursive: true,
                filter: skipPycache,
              });
            }
          }
          return true;
        },
      },
    },
  });
}

/**
 * API stack: the two text-to-speech Lambda functions (source in /lambda)
 * behind an API Gateway HTTP API at /api/v1/text-to-speech.
 *
 * POST runs the same Sound Along pipeline as the ETL (etl/pipeline.py), so
 * it writes the same layout to the shared StorageStack: files under `sa/`
 * in the media bucket (product JSON, per-track MP3 + gzipped timing) and the
 * product record in the reference table, keyed by passage id. See
 * docs/baseref.txt for the contract.
 */
export class ApiStack extends cdk.Stack {
  /** `/api/v1/text-to-speech` endpoint URL — FrontendStack wires this into the player at deploy time. */
  public readonly apiUrl: string;
  /** `/api/v1/data` base URL for the app-data API (roster, sessions, ratings, ...). */
  public readonly dataUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { config, mediaBucket, referenceTable } = props;

    // Names match what lambda/common/s3_store.py and
    // lambda/common/reference_store.py read.
    // Voices, engine and SSML settings come from etl/voices.json (bundled),
    // not from env vars.
    const ttsEnv = {
      TTS_MEDIA_BUCKET: mediaBucket.bucketName,
      TTS_REFERENCE_TABLE: referenceTable.tableName,
      TTS_S3_KEY_PREFIX: "sa/",
      TTS_URL_TTL_SECONDS: "3600",
    };

    // The AI assist endpoint talks to Bedrock, not S3/DynamoDB, so it gets its
    // own env (models + the child-safety guardrail). Values come from context
    // so they can be tuned without a code change; the guardrail id/version are
    // created out of band (see infra/cdk/README) and passed at deploy time.
    const assistEnv: Record<string, string> = {
      ASSIST_VALIDATE_MODEL:
        (this.node.tryGetContext("assistValidateModel") as string) ||
        process.env.ASSIST_VALIDATE_MODEL ||
        "us.amazon.nova-micro-v1:0",
      ASSIST_AUTOFILL_MODEL:
        (this.node.tryGetContext("assistAutofillModel") as string) ||
        process.env.ASSIST_AUTOFILL_MODEL ||
        "us.amazon.nova-lite-v1:0",
      ASSIST_GUARDRAIL_ID:
        (this.node.tryGetContext("assistGuardrailId") as string) ||
        process.env.ASSIST_GUARDRAIL_ID ||
        "",
      ASSIST_GUARDRAIL_VERSION:
        (this.node.tryGetContext("assistGuardrailVersion") as string) ||
        process.env.ASSIST_GUARDRAIL_VERSION ||
        "",
    };

    const makeFunction = (
      id: string,
      dirName: string,
      nameSuffix: string,
      memorySize: number,
      environment: Record<string, string> = ttsEnv
    ) =>
      new lambda.Function(this, id, {
        functionName: resourceName(config, "lambda", nameSuffix),
        // Lambda's newest Python runtime is 3.13 (no 3.14 yet).
        runtime: lambda.Runtime.PYTHON_3_13,
        handler: "handler.handler",
        code: functionCode(path.join(LAMBDA_ROOT, dirName)),
        environment,
        timeout: cdk.Duration.seconds(25), // HTTP API integration hard-caps at 29s
        memorySize,
      });

    // POST tokenizes, builds SSML and gzips timing: more memory = more CPU.
    const postFn = makeFunction("TextToSpeechPostFn", "text_to_speech_post", "tts-post", 1024);
    const getFn = makeFunction("TextToSpeechGetFn", "text_to_speech_get", "tts-get", 256);
    // LIST scans the reference table and returns a small summary per passage.
    const listFn = makeFunction("TextToSpeechListFn", "text_to_speech_list", "tts-list", 256);
    // ASSIST calls Bedrock (validate + autofill + translate) behind the guardrail.
    const assistFn = makeFunction("AssistFn", "assist", "assist", 256, assistEnv);
    // APPROVE flips an AI passage's review status to reviewed (S3 + DynamoDB).
    const approveFn = makeFunction("PassageApproveFn", "passage_approve", "approve", 256);

    // App data API (roster, sessions, assignments, practice, ratings, review).
    // No pipeline bundle; just common/ + the shared table.
    const dataFn = new lambda.Function(this, "DataApiFn", {
      functionName: resourceName(config, "lambda", "data"),
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: "handler.handler",
      code: functionCode(path.join(LAMBDA_ROOT, "data_api"), false),
      environment: ttsEnv,
      // Bedrock card/Word-Stop generation can take several seconds.
      timeout: cdk.Duration.seconds(25),
      memorySize: 256,
    });
    referenceTable.grantReadWriteData(dataFn);
    referenceTable.encryptionKey?.grantEncryptDecrypt(dataFn);
    // The /translate resource turns an English passage into Spanish text
    // (Amazon Translate has no resource-level permissions, only "*").
    dataFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["translate:TranslateText"],
        resources: ["*"],
      })
    );
    // The /cards and /stops resources call Bedrock (Converse) through a
    // cross-region inference profile, so allow both the region models and the
    // profile ARNs for this account.
    dataFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:${cdk.Aws.PARTITION}:bedrock:*::foundation-model/*`,
          `arn:${cdk.Aws.PARTITION}:bedrock:*:${cdk.Aws.ACCOUNT_ID}:inference-profile/*`,
        ],
      })
    );

    // grantReadWrite/grantRead also grant the needed KMS actions on the
    // bucket's and table's customer-managed keys.
    mediaBucket.grantReadWrite(postFn);
    mediaBucket.grantRead(getFn);
    referenceTable.grantWriteData(postFn);
    // POST refuses a client-supplied id that already exists (it must never
    // overwrite a passage), so it needs GetItem and decrypt on the table's key.
    // Narrower than grantReadData: no Query/Scan/BatchGet.
    referenceTable.grant(postFn, "dynamodb:GetItem");
    referenceTable.encryptionKey?.grantDecrypt(postFn);
    // GET reads the product record straight from S3 (sa/product/<id>.soundAlong.json),
    // not DynamoDB, so it needs no table grant.
    // LIST only scans the reference table for the passage summaries; no S3,
    // no writes. Scoped to Scan (plus decrypt for the table's KMS key).
    referenceTable.grant(listFn, "dynamodb:Scan");
    referenceTable.encryptionKey?.grantDecrypt(listFn);
    // APPROVE reads+writes the S3 product JSON and updates the DynamoDB item's
    // review status. Needs bucket read/write and table update (+ KMS).
    mediaBucket.grantReadWrite(approveFn);
    referenceTable.grant(approveFn, "dynamodb:UpdateItem");
    referenceTable.encryptionKey?.grantDecrypt(approveFn);

    // ASSIST invokes Bedrock models (cross-region inference profiles, so both
    // the profile ARN and the underlying foundation models must be allowed)
    // and applies the content-safety guardrail. No S3/DynamoDB access.
    assistFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          `arn:${cdk.Aws.PARTITION}:bedrock:*::foundation-model/*`,
          `arn:${cdk.Aws.PARTITION}:bedrock:*:${cdk.Aws.ACCOUNT_ID}:inference-profile/*`,
        ],
      })
    );
    if (assistEnv.ASSIST_GUARDRAIL_ID) {
      assistFn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["bedrock:ApplyGuardrail"],
          resources: [
            `arn:${cdk.Aws.PARTITION}:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:guardrail/${assistEnv.ASSIST_GUARDRAIL_ID}`,
          ],
        })
      );
    }

    // SynthesizeSpeech has no resource-level permissions, only "*".
    postFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["polly:SynthesizeSpeech"],
        resources: ["*"],
      })
    );
    // The pipeline uploads its pronunciation lexicons (saEnUS, saEsUS) once
    // per container, since every track sends LexiconNames. Scoped to the
    // pipeline's lexicons only.
    postFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["polly:PutLexicon", "polly:GetLexicon"],
        resources: [
          `arn:${cdk.Aws.PARTITION}:polly:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:lexicon/sa*`,
        ],
      })
    );

    const httpApi = new apigwv2.HttpApi(this, "TtsHttpApi", {
      apiName: resourceName(config, "apigateway", "tts"),
      description: "ReadWorks Sound Along — text-to-speech API",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["Content-Type"],
      },
    });

    httpApi.addRoutes({
      path: "/api/v1/text-to-speech",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("PostIntegration", postFn),
    });
    httpApi.addRoutes({
      path: "/api/v1/text-to-speech",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetIntegration", getFn),
    });
    // Lists every generated passage (summary only) so the player can show
    // user-entered passages in its picker. Reuses the same HTTP API.
    httpApi.addRoutes({
      path: "/api/v1/passages",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("ListIntegration", listFn),
    });
    // AI assist for the admin "Fill in with AI" button (validate + autofill +
    // translate), same HTTP API. The browser POSTs {text, mode}.
    httpApi.addRoutes({
      path: "/api/v1/assist",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("AssistIntegration", assistFn),
    });
    // Approve an AI-generated passage (flip reviewStatus to reviewed).
    httpApi.addRoutes({
      path: "/api/v1/passages/approve",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("ApproveIntegration", approveFn),
    });

    // App data API — one Lambda, resource is the last path segment.
    const dataIntegration = new HttpLambdaIntegration("DataIntegration", dataFn);
    httpApi.addRoutes({
      path: "/api/v1/data/{resource+}",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST, apigwv2.HttpMethod.DELETE],
      integration: dataIntegration,
    });

    this.apiUrl = `${httpApi.apiEndpoint}/api/v1/text-to-speech`;
    this.dataUrl = `${httpApi.apiEndpoint}/api/v1/data`;
    new cdk.CfnOutput(this, "ApiUrl", { value: this.apiUrl });
    new cdk.CfnOutput(this, "DataUrl", { value: this.dataUrl });
  }
}
