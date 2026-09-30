/**
 * production.ts — constraint values for the production environment.
 *
 * NOTHING HERE IS DEPLOYED. This environment is code-complete and
 * `cdk synth`-clean only. There is no production Supabase project, no
 * registered domain, and no production secrets with real values. Deploying it
 * would create real, unwanted, billable resources against an environment that
 * does not otherwise exist.
 *
 * See `architecture/infrastructure-as-code.md` for the full list of what must
 * be true before this is deployed for the first time.
 */

import type { EnvironmentConfig } from './types';

const ACCOUNT = '308855860393';
const REGION = 'us-east-1';

/**
 * PLACEHOLDER. No domain is registered on this AWS account
 * (`aws route53 list-hosted-zones` and `list-domains` are both empty as of
 * 2026-09-30). The production stack accepts this value and wires it into
 * outputs and the ALB's expected hostname, but deliberately provisions NO
 * Route53 hosted zone, record set, or ACM certificate against it — those
 * cannot be validated for a domain nobody owns.
 */
export const PRODUCTION_DOMAIN_PLACEHOLDER = 'app.example-carrieros-prod.invalid';

export const productionConfig: EnvironmentConfig = {
  envName: 'production',
  account: ACCOUNT,
  region: REGION,
  clusterName: 'default',

  network: {
    // Reuses the same default VPC. A production build would more likely want a
    // dedicated VPC with private subnets + NAT; called out as a deferred
    // decision in architecture/infrastructure-as-code.md rather than silently
    // assumed here.
    vpcId: 'vpc-08e40735030c9aea8',
    vpcCidrBlock: '172.31.0.0/16',
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
    // Production creates its own roles rather than sharing staging's, so a
    // staging policy widening cannot grant production access. The production
    // stack creates these; the ARNs below are the names it will create.
    executionRoleArn: `arn:aws:iam::${ACCOUNT}:role/carrieros-ecsTaskExecutionRole-production`,
    // No infrastructure role: production does not use Express Gateway.
    infrastructureRoleArn: undefined,
  },

  // Production needs a stable custom domain, a WAF association, and finer
  // blue/green control. Express Gateway has no custom-domain parameter at all
  // and hands out a new random hostname on every recreate, so production builds
  // its own ALB + target group + listener in front of a standard FargateService.
  albStrategy: 'custom-alb',

  // Real HA floor: never fewer than 2 tasks, so one AZ or one task failing does
  // not mean an outage.
  minTaskCount: 2,
  // Left configurable with a conservative default — there is no real production
  // load data yet, so a higher ceiling would be a guess dressed up as a limit.
  maxTaskCount: 4,
  autoScalingTargetCpuPercent: 60,

  // Every AZ that has a subnet in the VPC.
  albAzCount: 'all',

  wafEnabled: true,
  logRetentionDays: 30,
  ecrKeepLastImages: 20,

  // Deliberately NOT push-to-deploy. Production promotion is an explicit manual
  // step; merging to main must not be sufficient to change production.
  autoDeployOnPushToMain: false,

  // TODO(requires a registered domain): full SPF/DKIM/DMARC domain
  // verification. Not implemented — `sesDomain` below is inert, and the stack
  // creates no SES identity for production. See
  // architecture/infrastructure-as-code.md.
  sesMode: 'domain-verification',
  sesDomain: 'example-carrieros-prod.invalid',

  domainName: PRODUCTION_DOMAIN_PLACEHOLDER,

  services: {
    web: {
      serviceName: 'carrieros-web-production',
      ecrRepositoryName: 'carrieros-web',
      // Production pins an immutable tag rather than tracking `latest`, so a
      // promote is an explicit, auditable value change. Replaced by the real
      // release SHA at promote time.
      imageTag: 'REPLACE_WITH_RELEASE_SHA',
      containerPort: 3000,
      healthCheckPath: '/login',
      cpu: '1024',
      memory: '2048',
      environment: {},
      // TODO(requires a production Supabase project): these secrets are created
      // empty by the production stack and must be populated out-of-band. No
      // secret value appears in this repo.
      secretArns: {},
    },
    mcp: {
      serviceName: 'carrieros-mcp-production',
      ecrRepositoryName: 'carrieros-mcp',
      imageTag: 'REPLACE_WITH_RELEASE_SHA',
      containerPort: 3000,
      healthCheckPath: '/health',
      cpu: '512',
      memory: '1024',
      environment: {},
      secretArns: {},
    },
  },
};
