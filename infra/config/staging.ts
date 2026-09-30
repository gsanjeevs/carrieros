/**
 * staging.ts — constraint values for the CDK-managed staging environment.
 *
 * This describes a NEW, parallel staging environment. It deliberately uses
 * `-cdk`-suffixed service names so it cannot collide with the original
 * hand-built `carrieros-web-staging` / `carrieros-mcp-staging` services, which
 * this stack neither reads into its own state nor mutates.
 *
 * Every AWS id below was read off the live account rather than guessed:
 *   aws secretsmanager list-secrets --region us-east-1
 *   aws ec2 describe-vpcs --region us-east-1
 *   aws ec2 describe-subnets --region us-east-1
 *   aws iam list-roles
 */

import type { EnvironmentConfig } from './types';

const ACCOUNT = '308855860393';
const REGION = 'us-east-1';

/**
 * Existing Secrets Manager secrets, by exact ARN (including AWS's 6-character
 * random suffix, which is part of the ARN and cannot be reconstructed from the
 * name). Reused as-is — this stack creates no duplicate staging secrets.
 *
 * Only a subset is injected into containers: `DATABASE_URL` is consumed by the
 * migration workflow, and `SMTP_CREDENTIALS` by Supabase Auth's own SMTP
 * config, so neither belongs in an app container's environment. They are listed
 * here because the task execution role's read policy is scoped to the whole
 * `carrieros-staging/*` prefix and these are part of that set.
 */
export const STAGING_SECRET_ARNS = {
  SUPABASE_SERVICE_ROLE_KEY:
    'arn:aws:secretsmanager:us-east-1:308855860393:secret:carrieros-staging/SUPABASE_SERVICE_ROLE_KEY-H5wiNI',
  DATABASE_URL:
    'arn:aws:secretsmanager:us-east-1:308855860393:secret:carrieros-staging/DATABASE_URL-g2P2AC',
  PUBLIC_API_JWT_SECRET:
    'arn:aws:secretsmanager:us-east-1:308855860393:secret:carrieros-staging/PUBLIC_API_JWT_SECRET-T2pNlS',
  SMTP_CREDENTIALS:
    'arn:aws:secretsmanager:us-east-1:308855860393:secret:carrieros-staging/SMTP_CREDENTIALS-6YgLjw',
  MCP_OAUTH_ENCRYPTION_KEY:
    'arn:aws:secretsmanager:us-east-1:308855860393:secret:carrieros-staging/MCP_OAUTH_ENCRYPTION_KEY-SQ30d1',
} as const;

export const stagingConfig: EnvironmentConfig = {
  envName: 'staging',
  account: ACCOUNT,
  region: REGION,
  clusterName: 'default',

  network: {
    // The account's default VPC. Reused, never created.
    vpcId: 'vpc-08e40735030c9aea8',
    vpcCidrBlock: '172.31.0.0/16',
    // Stable order; `albAzCount` takes a prefix of this list.
    publicSubnets: [
      { subnetId: 'subnet-0e85318637782d2a6', availabilityZone: 'us-east-1a' },
      { subnetId: 'subnet-0df412c011c9705d2', availabilityZone: 'us-east-1b' },
      { subnetId: 'subnet-08db3014856f24a34', availabilityZone: 'us-east-1c' },
      { subnetId: 'subnet-0bdb235053080a5d6', availabilityZone: 'us-east-1d' },
      { subnetId: 'subnet-02737b360dc9076bf', availabilityZone: 'us-east-1e' },
      { subnetId: 'subnet-007d9aae886a86c3c', availabilityZone: 'us-east-1f' },
    ],
  },

  iam: {
    executionRoleArn: `arn:aws:iam::${ACCOUNT}:role/carrieros-ecsTaskExecutionRole`,
    infrastructureRoleArn: `arn:aws:iam::${ACCOUNT}:role/carrieros-ecsInfrastructureRole`,
  },

  // Staging keeps the low-IaC-surface Express Gateway pattern already in use.
  albStrategy: 'express-gateway',

  // Costs nothing at rest. See the `minTaskCount` note in types.ts: 0 means the
  // service will NOT wake on its own — scripts/staging-resume.sh exists for that.
  minTaskCount: 0,
  maxTaskCount: 1,
  autoScalingTargetCpuPercent: 60,

  // 2 is the AWS minimum for an ALB. Staging does not need real HA.
  albAzCount: 2,

  wafEnabled: false,
  logRetentionDays: 7,
  ecrKeepLastImages: 5,

  // Matches the current CodeBuild push-to-main behavior.
  autoDeployOnPushToMain: true,

  sesMode: 'single-sender',
  sesSenderIdentity: 'sanjeev@shipmentx.com',

  // Staging keeps the generated *.ecs.us-east-1.on.aws hostname.
  domainName: undefined,

  services: {
    web: {
      serviceName: 'carrieros-web-staging-cdk',
      ecrRepositoryName: 'carrieros-web',
      imageTag: 'latest',
      containerPort: 3000,
      // The web app has no unauthenticated /health route; /login is what the
      // existing hand-built service health-checks, so match it.
      healthCheckPath: '/login',
      cpu: '1024',
      memory: '2048',
      environment: {},
      secretArns: {
        PUBLIC_API_JWT_SECRET: STAGING_SECRET_ARNS.PUBLIC_API_JWT_SECRET,
        SUPABASE_SERVICE_ROLE_KEY: STAGING_SECRET_ARNS.SUPABASE_SERVICE_ROLE_KEY,
      },
    },
    mcp: {
      serviceName: 'carrieros-mcp-staging-cdk',
      ecrRepositoryName: 'carrieros-mcp',
      imageTag: 'latest',
      containerPort: 3000,
      healthCheckPath: '/health',
      cpu: '512',
      memory: '1024',
      // CARRIEROS_BASE_URL is injected by the stack from the sibling web
      // service's own endpoint, so this parallel environment is self-contained
      // and does not point at the hand-built staging web service.
      // MCP_PUBLIC_URL cannot be set here on a first deploy: it is this
      // service's own endpoint, and a CloudFormation resource cannot GetAtt
      // itself. See infra/README.md "Two-phase MCP_PUBLIC_URL".
      environment: {},
      secretArns: {
        MCP_OAUTH_ENCRYPTION_KEY: STAGING_SECRET_ARNS.MCP_OAUTH_ENCRYPTION_KEY,
      },
    },
  },
};
