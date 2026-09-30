#!/usr/bin/env node
/**
 * deploy.ts — the single CDK app entrypoint for every CarrierOS environment.
 *
 *   cdk synth  --context env=staging
 *   cdk deploy --context env=staging --all
 *   cdk synth  --context env=production      # synth only — never deploy
 *
 * The environment flag selects a config file; the config's `albStrategy`
 * selects which stack class gets instantiated. There is no other branching.
 */

import * as cdk from 'aws-cdk-lib';
import { stagingConfig } from '../config/staging';
import { productionConfig } from '../config/production';
import type { EnvironmentConfig } from '../config/types';
import { NetworkStack } from '../lib/network-stack';
import { EcrStack } from '../lib/ecr-stack';
import { StagingStack } from '../lib/staging-stack';
import { ProductionStack } from '../lib/production-stack';

const app = new cdk.App();

const envName = app.node.tryGetContext('env') as string | undefined;

if (!envName) {
  throw new Error(
    'Missing required context: pass --context env=staging or --context env=production.',
  );
}

const configs: Record<string, EnvironmentConfig> = {
  staging: stagingConfig,
  production: productionConfig,
};

const config = configs[envName];
if (!config) {
  throw new Error(
    `Unknown env '${envName}'. Valid values: ${Object.keys(configs).join(', ')}.`,
  );
}

const env: cdk.Environment = { account: config.account, region: config.region };

// Prefix every stack name with the environment so two environments can coexist
// in one account without colliding, and so a `cdk deploy --all` is always
// scoped to exactly one environment.
const prefix = `CarrierOS-${config.envName}`;

const network = new NetworkStack(app, `${prefix}-Network`, {
  env,
  config,
  description: `CarrierOS ${config.envName}: reused VPC + task security group`,
});

const ecr = new EcrStack(app, `${prefix}-Ecr`, {
  env,
  config,
  description: `CarrierOS ${config.envName}: ECR retention (keep last ${config.ecrKeepLastImages})`,
});

switch (config.albStrategy) {
  case 'express-gateway': {
    const staging = new StagingStack(app, `${prefix}-Services`, {
      env,
      config,
      vpc: network.vpc,
      serviceSubnetIds: network.serviceSubnetIds,
      taskSecurityGroup: network.taskSecurityGroup,
      // Second-deploy-only value; see StagingStackProps.mcpPublicUrl.
      mcpPublicUrl: app.node.tryGetContext('mcpPublicUrl') as string | undefined,
      description: `CarrierOS ${config.envName}: ECS Express Gateway services (web + mcp)`,
    });
    staging.addStackDependency(network);
    staging.addStackDependency(ecr);
    break;
  }
  case 'custom-alb': {
    if (!network.albSecurityGroup) {
      throw new Error(
        "NetworkStack did not create an ALB security group — expected it for albStrategy 'custom-alb'.",
      );
    }
    const production = new ProductionStack(app, `${prefix}-Services`, {
      env,
      config,
      vpc: network.vpc,
      serviceSubnetIds: network.serviceSubnetIds,
      taskSecurityGroup: network.taskSecurityGroup,
      albSecurityGroup: network.albSecurityGroup,
      description: `CarrierOS ${config.envName}: custom ALB + Fargate services (web + mcp)`,
    });
    production.addStackDependency(network);
    production.addStackDependency(ecr);
    break;
  }
  default: {
    // Exhaustiveness guard: adding a new strategy to the union without handling
    // it here is a compile error, not a silent no-op deploy.
    const unreachable: never = config.albStrategy;
    throw new Error(`Unhandled albStrategy: ${String(unreachable)}`);
  }
}

// Tag everything, so a cost report can separate the CDK-managed environment
// from the original hand-built staging resources.
// The reused default-VPC subnets are imported by id, so CDK has no route table
// id for them. Nothing in this app reads `.routeTable.routeTableId`, so this is
// acknowledged deliberately rather than left to bury real warnings in noise on
// every synth.
cdk.Annotations.of(app).acknowledgeWarning(
  '@aws-cdk/aws-ec2:noSubnetRouteTableId',
  'Subnets are imported from the existing default VPC by id; no code reads their route tables.',
);

cdk.Tags.of(app).add('Project', 'CarrierOS');
cdk.Tags.of(app).add('Environment', config.envName);
cdk.Tags.of(app).add('ManagedBy', 'cdk');

app.synth();
