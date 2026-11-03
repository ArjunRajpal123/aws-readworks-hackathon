import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import { AppConfig } from "./config";

export interface PipelineStackProps extends cdk.StackProps {
  readonly config: AppConfig;
}

/**
 * CI/CD pipeline to validate deployment end to end:
 *   GitHub (CodeConnections) -> CodeBuild validation build.
 *
 * Minimal on purpose; replace the build step with real synth/test/deploy
 * steps as the project grows.
 */
export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const { config } = props;
    const prefix = `${config.projectName}-${config.environment}`;

    // Validation build. buildSpec is inlined so the pipeline is self-contained.
    const project = new codebuild.PipelineProject(this, "BuildProject", {
      projectName: `${prefix}-build`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            "runtime-versions": { nodejs: "18" },
          },
          build: {
            commands: [
              'echo "Pipeline reached the build stage at $(date)"',
              "ls -la",
              'echo "Validation build succeeded."',
            ],
          },
        },
        artifacts: { files: ["**/*"] },
      }),
    });

    const sourceOutput = new codepipeline.Artifact("SourceOutput");
    const buildOutput = new codepipeline.Artifact("BuildOutput");

    new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: `${prefix}-pipeline`,
      pipelineType: codepipeline.PipelineType.V2,
      stages: [
        {
          stageName: "Source",
          actions: [
            new actions.CodeStarConnectionsSourceAction({
              actionName: "Source",
              owner: config.github.owner,
              repo: config.github.repo,
              branch: config.github.branch,
              connectionArn: config.github.connectionArn,
              output: sourceOutput,
            }),
          ],
        },
        {
          stageName: "Build",
          actions: [
            new actions.CodeBuildAction({
              actionName: "Build",
              project,
              input: sourceOutput,
              outputs: [buildOutput],
            }),
          ],
        },
      ],
    });
  }
}
