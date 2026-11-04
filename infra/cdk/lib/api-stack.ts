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
const LAMBDA_ROOT = path.join(REPO_ROOT, "lambda");
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
function functionCode(functionDir: string): lambda.Code {
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
          for (const name of ETL_RUNTIME_FILES) {
            fs.cpSync(path.join(ETL_DIR, name), path.join(outputDir, name), {
              recursive: true,
              filter: skipPycache,
            });
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

    const makeFunction = (id: string, dirName: string, nameSuffix: string, memorySize: number) =>
      new lambda.Function(this, id, {
        functionName: resourceName(config, "lambda", nameSuffix),
        // Lambda's newest Python runtime is 3.13 (no 3.14 yet).
        runtime: lambda.Runtime.PYTHON_3_13,
        handler: "handler.handler",
        code: functionCode(path.join(LAMBDA_ROOT, dirName)),
        environment: ttsEnv,
        timeout: cdk.Duration.seconds(25), // HTTP API integration hard-caps at 29s
        memorySize,
      });

    // POST tokenizes, builds SSML and gzips timing: more memory = more CPU.
    const postFn = makeFunction("TextToSpeechPostFn", "text_to_speech_post", "tts-post", 1024);
    const getFn = makeFunction("TextToSpeechGetFn", "text_to_speech_get", "tts-get", 256);

    // grantReadWrite/grantRead also grant the needed KMS actions on the
    // bucket's and table's customer-managed keys.
    mediaBucket.grantReadWrite(postFn);
    mediaBucket.grantRead(getFn);
    referenceTable.grantWriteData(postFn);
    referenceTable.grantReadData(getFn);

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
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST],
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

    new cdk.CfnOutput(this, "ApiUrl", {
      value: `${httpApi.apiEndpoint}/api/v1/text-to-speech`,
    });
  }
}
