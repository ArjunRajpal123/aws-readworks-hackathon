import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as eks from "aws-cdk-lib/aws-eks";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import { KubectlV35Layer } from "@aws-cdk/lambda-layer-kubectl-v35";
import * as path from "path";
import { AppConfig, resourceName } from "./config";

export interface FrontendStackProps extends cdk.StackProps {
  readonly config: AppConfig;
  readonly mediaBucket: s3.Bucket;
  /** ApiStack's apiUrl — written into the running pod as SA_API_URL (see docker-entrypoint.d/10-write-config.sh). */
  readonly apiUrl: string;
  /** Sign-in settings for the player (AuthStack), written into config.js in the pod. */
  readonly auth: { userPoolId: string; clientId: string };
}

const APP = "sound-along-web";
const NAMESPACE = "default";

/**
 * The Vue player on EKS.
 *
 *   VPC (2 AZs, 1 NAT) -> EKS 1.35 cluster, 1x t3.medium managed node (private subnets)
 *   Deployment (2 pods): nginx serving the Vite build + an aws-cli sidecar that
 *     syncs s3://<media>/sa/ into a shared volume every 30 s (read-only IRSA role)
 *   Service type LoadBalancer -> internet-facing NLB, plain HTTP on port 80
 *
 * The frontend image is built from frontend/Dockerfile and pushed to the CDK
 * bootstrap ECR repo by `cdk deploy` (needs Docker locally).
 */
export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);
    const { config, mediaBucket, apiUrl } = props;

    const vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: resourceName(config, "vpc", "web"),
      maxAzs: 2,
      natGateways: 1, // sandbox: one NAT instead of one per AZ
    });
    // Load balancer subnet discovery for Service type LoadBalancer.
    for (const s of vpc.publicSubnets) cdk.Tags.of(s).add("kubernetes.io/role/elb", "1");
    for (const s of vpc.privateSubnets) cdk.Tags.of(s).add("kubernetes.io/role/internal-elb", "1");

    const cluster = new eks.Cluster(this, "Cluster", {
      clusterName: resourceName(config, "eks", "web"),
      version: eks.KubernetesVersion.V1_35,
      kubectlLayer: new KubectlV35Layer(this, "KubectlLayer"),
      vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      defaultCapacity: 0,
      authenticationMode: eks.AuthenticationMode.API_AND_CONFIG_MAP,
      endpointAccess: eks.EndpointAccess.PUBLIC_AND_PRIVATE,
    });
    cluster.addNodegroupCapacity("WebNodes", {
      nodegroupName: resourceName(config, "ng", "web"),
      instanceTypes: [new ec2.InstanceType("t3.medium")],
      amiType: eks.NodegroupAmiType.AL2023_X86_64_STANDARD,
      minSize: 1,
      desiredSize: 1,
      maxSize: 2,
      diskSize: 20,
    });
    if (config.eksAdminRoleArn) {
      cluster.grantAccess("AdminAccess", config.eksAdminRoleArn, [
        eks.AccessPolicy.fromAccessPolicyName("AmazonEKSClusterAdminPolicy", {
          accessScopeType: eks.AccessScopeType.CLUSTER,
        }),
      ]);
    }

    // Pod identity (IRSA): read-only on the media bucket (+ KMS decrypt).
    const sa = cluster.addServiceAccount("WebServiceAccount", { name: APP, namespace: NAMESPACE });
    // GetObject on sa/* only; grantRead also adds bucket-level List* for `aws s3 sync`.
    mediaBucket.grantRead(sa, "sa/*");

    const image = new ecrAssets.DockerImageAsset(this, "WebImage", {
      directory: path.join(__dirname, "..", "..", "..", "frontend"),
      platform: ecrAssets.Platform.LINUX_AMD64,
    });

    const labels = { app: APP };
    const deployment = cluster.addManifest("WebDeployment", {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: APP, namespace: NAMESPACE, labels },
      spec: {
        replicas: 2,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            serviceAccountName: APP,
            volumes: [{ name: "sa-data", emptyDir: {} }],
            containers: [
              {
                name: "web",
                image: image.imageUri,
                ports: [{ containerPort: 80 }],
                // Read by docker-entrypoint.d/10-write-config.sh at container start, which writes
                // it into /usr/share/nginx/html/config.js (window.SA_API_URL) for src/api.js to
                // read at runtime -- the image itself is built with no API URL baked in.
                env: [
                  { name: "SA_API_URL", value: apiUrl },
                  { name: "SA_AUTH_REGION", value: cdk.Aws.REGION },
                  { name: "SA_AUTH_USER_POOL_ID", value: props.auth.userPoolId },
                  { name: "SA_AUTH_CLIENT_ID", value: props.auth.clientId },
                ],
                volumeMounts: [{ name: "sa-data", mountPath: "/data/sa", readOnly: true }],
                resources: { requests: { cpu: "50m", memory: "64Mi" }, limits: { memory: "128Mi" } },
                readinessProbe: { httpGet: { path: "/healthz", port: 80 }, periodSeconds: 5 },
                livenessProbe: { httpGet: { path: "/healthz", port: 80 }, periodSeconds: 20 },
              },
              {
                name: "sync",
                image: "public.ecr.aws/aws-cli/aws-cli:latest",
                command: ["/bin/sh", "-c"],
                args: [
                  `while true; do aws s3 sync s3://${mediaBucket.bucketName}/sa/ /data/sa/ ` +
                  `--delete --only-show-errors --exclude '*.marks.jsonl' --exclude '*.input.*'; sleep 30; done`,
                ],
                env: [{ name: "AWS_REGION", value: cdk.Aws.REGION }],
                volumeMounts: [{ name: "sa-data", mountPath: "/data/sa" }],
                resources: { requests: { cpu: "20m", memory: "96Mi" }, limits: { memory: "256Mi" } },
              },
            ],
          },
        },
      },
    });
    deployment.node.addDependency(sa);

    const service = cluster.addManifest("WebService", {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: APP,
        namespace: NAMESPACE,
        annotations: {
          "service.beta.kubernetes.io/aws-load-balancer-type": "nlb",
          "service.beta.kubernetes.io/aws-load-balancer-scheme": "internet-facing",
        },
      },
      spec: {
        type: "LoadBalancer",
        selector: labels,
        ports: [{ port: 80, targetPort: 80, protocol: "TCP" }],
      },
    });

    const lbHost = new eks.KubernetesObjectValue(this, "WebLbHost", {
      cluster,
      objectType: "service",
      objectName: APP,
      objectNamespace: NAMESPACE,
      jsonPath: ".status.loadBalancer.ingress[0].hostname",
      timeout: cdk.Duration.minutes(10),
    });
    lbHost.node.addDependency(service);

    // HTTPS front door. The NLB stays plain HTTP (no cert); CloudFront
    // terminates TLS with its default *.cloudfront.net certificate.
    const cdn = new cloudfront.Distribution(this, "WebCdn", {
      comment: "Sound Along web player (EKS NLB origin)",
      defaultBehavior: {
        origin: new origins.HttpOrigin(lbHost.value, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // index.html and sa/ JSON change on redeploy / regeneration.
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      },
      additionalBehaviors: {
        "/assets/*": {
          origin: new origins.HttpOrigin(lbHost.value, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED, // hashed filenames
        },
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    new cdk.CfnOutput(this, "WebUrl", { value: `http://${lbHost.value}/` });
    new cdk.CfnOutput(this, "HttpsUrl", { value: `https://${cdn.distributionDomainName}/` });
    new cdk.CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new cdk.CfnOutput(this, "KubeconfigCommand", {
      value: `aws eks update-kubeconfig --region ${cdk.Aws.REGION} --name ${cluster.clusterName}`,
    });
  }
}
