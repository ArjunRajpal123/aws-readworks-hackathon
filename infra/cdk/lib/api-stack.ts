import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { AppConfig, resourceName } from "./config";

export interface ApiStackProps extends cdk.StackProps {
  readonly config: AppConfig;
  /** Shared media bucket from StorageStack — audio/text blobs land here. */
  readonly mediaBucket: s3.Bucket;
  /** Shared reference table from StorageStack — one item per request, PK `id`. */
  readonly referenceTable: dynamodb.Table;
}

// ../../lambda relative to this file (infra/cdk/lib/api-stack.ts -> lambda/)
const LAMBDA_ROOT = path.join(__dirname, "..", "..", "..", "lambda");
const COMMON_DIR = path.join(LAMBDA_ROOT, "common");

/**
 * Each function's asset bundle is the function's own directory plus a copy
 * of the shared `lambda/common` package, laid out as siblings exactly like
 * local dev (see lambda/scripts/invoke_local.py) so `from common.x import y`
 * resolves the same way at runtime. No Docker required: boto3/botocore ship
 * with the Lambda Python runtime already, so this is a plain file copy, not
 * a pip install.
 */
// Hash every .py file under a dir so edits to shared `common/` (which lives
// outside the function dir) invalidate the asset and trigger a redeploy.
function hashPyTree(dir: string, hash: crypto.Hash): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    if (entry.name === "__pycache__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      hashPyTree(full, hash);
    } else if (entry.name.endsWith(".py")) {
      hash.update(full).update(fs.readFileSync(full));
    }
  }
}

function functionCode(functionDir: string): lambda.Code {
  // Custom asset hash over the function dir + shared common/ so changes to
  // either are detected (fromAsset alone only hashes functionDir).
  const hash = crypto.createHash("sha256");
  hashPyTree(functionDir, hash);
  hashPyTree(COMMON_DIR, hash);

  return lambda.Code.fromAsset(functionDir, {
    assetHash: hash.digest("hex"),
    assetHashType: cdk.AssetHashType.CUSTOM,
    bundling: {
      image: lambda.Runtime.PYTHON_3_12.bundlingImage,
      local: {
        tryBundle(outputDir: string): boolean {
          const skipPycache = (src: string) => !src.includes("__pycache__");
          fs.cpSync(functionDir, outputDir, { recursive: true, filter: skipPycache });
          fs.cpSync(COMMON_DIR, path.join(outputDir, "common"), {
            recursive: true,
            filter: skipPycache,
          });
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
 * Storage is the shared StorageStack: blobs go in the media bucket under a
 * `tts/` prefix (kept separate from the main passage pipeline's eventual key
 * layout), and the per-request record (id, text/audio paths, word timing)
 * goes in the reference table alongside passage metadata.
 */
export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { config, mediaBucket, referenceTable } = props;

    // Names match what lambda/common/s3_store.py and
    // lambda/common/reference_store.py read. Text-only: no Polly/audio vars.
    const ttsEnv = {
      TTS_MEDIA_BUCKET: mediaBucket.bucketName,
      TTS_TEXT_S3_KEY_PREFIX: "text",
      TTS_REFERENCE_TABLE: referenceTable.tableName,
      TTS_URL_TTL_SECONDS: "3600",
    };

    const makeFunction = (id: string, dirName: string, nameSuffix: string) =>
      new lambda.Function(this, id, {
        functionName: resourceName(config, "lambda", nameSuffix),
        // Lambda has no Python 3.14 runtime; use the latest available.
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "handler.handler",
        code: functionCode(path.join(LAMBDA_ROOT, dirName)),
        environment: ttsEnv,
        timeout: cdk.Duration.seconds(25), // HTTP API integration hard-caps at 29s
        memorySize: 512,
      });

    const postFn = makeFunction("TextToSpeechPostFn", "text_to_speech_post", "tts-post");
    const getFn = makeFunction("TextToSpeechGetFn", "text_to_speech_get", "tts-get");

    // grantReadWrite/grantRead also grant the needed KMS actions on the
    // bucket's and table's customer-managed keys.
    mediaBucket.grantReadWrite(postFn);
    mediaBucket.grantRead(getFn);
    referenceTable.grantWriteData(postFn);
    referenceTable.grantReadData(getFn);

    // No Polly: text-only ingest, so no polly:SynthesizeSpeech grant needed.

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
