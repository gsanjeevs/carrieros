/**
 * network-stack.ts — reuses the account's existing default VPC and owns the
 * security group the app tasks run in.
 *
 * This stack deliberately does NOT create a VPC. The account already has a
 * default VPC with six public subnets (one per AZ) that the hand-built staging
 * environment already uses; creating a second one would add cost, NAT/routing
 * surface and confusion for no benefit at this stage.
 *
 * Why `fromVpcAttributes` and not `Vpc.fromLookup`:
 * `fromLookup` performs a live AWS API call at synth time and caches the answer
 * into `cdk.context.json`. That makes `cdk synth` require valid credentials,
 * makes synth output depend on machine-local cache state, and silently drifts if
 * the cache is stale. Pinning the real ids in `config/*.ts` instead keeps synth
 * deterministic, offline, and reviewable in a diff. The ids were read off the
 * live account (see the comment block in `config/staging.ts`), not guessed.
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/types';

export interface NetworkStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
}

export class NetworkStack extends cdk.Stack {
  /** The reused, pre-existing VPC. */
  public readonly vpc: ec2.IVpc;

  /**
   * Subnets the load balancer and tasks are placed in, narrowed to
   * `config.albAzCount` AZs.
   */
  public readonly serviceSubnetIds: string[];

  /** Security group the app tasks run in. */
  public readonly taskSecurityGroup: ec2.ISecurityGroup;

  /**
   * Security group for a self-managed ALB. Only created for the `custom-alb`
   * strategy (production); Express Gateway provisions and owns its own.
   *
   * This lives in the network stack rather than alongside the ALB itself for a
   * concrete reason: attaching a Fargate service to a target group makes CDK
   * add an ingress rule to the TASK security group allowing traffic from the
   * ALB's security group. If the ALB security group lived in the services
   * stack, that rule would make the network stack depend on the services stack
   * while the services stack already depends on the network stack — a
   * CloudFormation dependency cycle, which CDK rejects at synth. Keeping both
   * security groups in one stack keeps the reference intra-stack.
   */
  public readonly albSecurityGroup?: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const { config } = props;
    const subnets = config.network.publicSubnets;

    const azCount =
      config.albAzCount === 'all'
        ? subnets.length
        : Math.min(config.albAzCount, subnets.length);

    if (azCount < 2) {
      // An ALB requires at least two AZs. Fail at synth rather than discovering
      // this as a CloudFormation rollback several minutes into a deploy.
      throw new Error(
        `albAzCount must resolve to at least 2 availability zones (got ${azCount}) — an ALB cannot be created in one AZ.`,
      );
    }

    const selected = subnets.slice(0, azCount);
    this.serviceSubnetIds = selected.map((s) => s.subnetId);

    this.vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: config.network.vpcId,
      availabilityZones: selected.map((s) => s.availabilityZone),
      publicSubnetIds: this.serviceSubnetIds,
    });

    const sg = new ec2.SecurityGroup(this, 'TaskSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `carrieros-${config.envName}-cdk-tasks`,
      description: `CarrierOS ${config.envName} (CDK-managed) app task security group`,
      allowAllOutbound: true,
    });

    const ports = new Set<number>([
      config.services.web.containerPort,
      config.services.mcp.containerPort,
    ]);

    if (config.albStrategy === 'custom-alb') {
      // This stack owns the load balancer's security group, so task ingress can
      // be scoped precisely to it rather than to a whole CIDR.
      const alb = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
        vpc: this.vpc,
        securityGroupName: `carrieros-${config.envName}-alb`,
        description: `CarrierOS ${config.envName} ALB`,
        allowAllOutbound: true,
      });
      alb.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(80),
        'Public HTTP (TODO: move to 443 once an ACM certificate exists)',
      );
      this.albSecurityGroup = alb;

      for (const port of ports) {
        sg.addIngressRule(
          alb,
          ec2.Port.tcp(port),
          `Load balancer to task on ${port}`,
        );
      }
    } else {
      // Express Gateway provisions the ALB and its security group itself, and
      // that managed security group's id is an *output* of the very resource
      // this security group is an *input* to — referencing it would be a
      // circular CloudFormation dependency. Scoping ingress to the VPC CIDR is
      // the non-circular way to express "only in-VPC callers", which is all the
      // gateway-managed load balancer ever is.
      for (const port of ports) {
        sg.addIngressRule(
          ec2.Peer.ipv4(config.network.vpcCidrBlock),
          ec2.Port.tcp(port),
          `In-VPC load balancer to task on ${port}`,
        );
      }
    }

    this.taskSecurityGroup = sg;

    new cdk.CfnOutput(this, 'VpcIdOutput', {
      value: config.network.vpcId,
      description: 'Reused existing VPC id (not created by CDK)',
    });
    new cdk.CfnOutput(this, 'ServiceSubnetIdsOutput', {
      value: this.serviceSubnetIds.join(','),
      description: `Subnets in use (${azCount} AZs)`,
    });
  }
}
