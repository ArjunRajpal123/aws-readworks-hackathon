import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as fs from "fs";
import * as path from "path";
import { AppConfig } from "./config";

export interface ApiStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

// ../../lambda relative to this file (infra/cdk/lib/api-stack.ts -> lambda/)
const LAMBDA_ROOT = path.join(__dirname, "..", "..", "..", "lambda");
const COMMON_DIR = path.join(LAMBDA_ROOT, "common");

/**
 * API stack: the two text-to-speech Lambda functions (source in /lambda)
 * behind an API Gateway HTTP API at /api/v1/text-to-speech.
 *
 * Each function's asset bundle is the function's own directory plus a copy
 * of the shared `lambda/common` package, laid out as siblings exactly like
 * local dev (see lambda/scripts/invoke_local.py) so `from common.x import y`
 * resolves the same way at runtime. No Docker required: boto3/botocore ship
 * with the Lambda Python runtime already, so this is a plain file copy, not
 * a pip install.
 */
function functionCode(functionDir: string): lambda.Code {
  return lambda.Code.fromAsset(functionDir, {
    bundling: {
      image: lambda.Runtime.PYTHON_3_14.bundlingImage,
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

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { config } = props;
    const namePrefix = `${config.projectName}-${config.environment}`.toLowerCase();
    const isProd = config.environment === "prod";

    const ttsBucket = new s3.Bucket(this, "TtsBucket", {
      bucketName: `${namePrefix}-tts`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // Names match what lambda/common/polly.py and lambda/common/s3_store.py read.
    const ttsEnv = {
      TTS_OUTPUT_BUCKET: ttsBucket.bucketName,
      TTS_TEXT_S3_KEY_PREFIX: "texts",
      TTS_AUDIO_S3_KEY_PREFIX: "audio",
      TTS_RECORD_S3_KEY_PREFIX: "records",
      TTS_URL_TTL_SECONDS: "3600",
      TTS_DEFAULT_VOICE_ID: "Joanna",
      TTS_DEFAULT_ENGINE: "neural",
      TTS_DEFAULT_LANGUAGE_CODE: "en-US",
    };

    const makeFunction = (id: string, dirName: string) =>
      new lambda.Function(this, id, {
        functionName: `${namePrefix}-${dirName.replace(/_/g, "-")}`,
        runtime: lambda.Runtime.PYTHON_3_14,
        handler: "handler.handler",
        code: functionCode(path.join(LAMBDA_ROOT, dirName)),
        environment: ttsEnv,
        timeout: cdk.Duration.seconds(25), // HTTP API integration hard-caps at 29s
        memorySize: 512,
      });

    const postFn = makeFunction("TextToSpeechPostFn", "text_to_speech_post");
    const getFn = makeFunction("TextToSpeechGetFn", "text_to_speech_get");

    ttsBucket.grantReadWrite(postFn);
    ttsBucket.grantRead(getFn);

    // Polly's SynthesizeSpeech has no resource-level permissions, only "*".
    const pollyPolicy = new iam.PolicyStatement({
      actions: ["polly:SynthesizeSpeech"],
      resources: ["*"],
    });
    postFn.addToRolePolicy(pollyPolicy);

    const httpApi = new apigwv2.HttpApi(this, "TtsHttpApi", {
      apiName: `${namePrefix}-api`,
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
