/**
 * staging-stack.ts — the CDK-managed staging environment, built on ECS Express
 * Gateway (`AWS::ECS::ExpressGatewayService`).
 *
 * Express Gateway auto-provisions the ALB, target group, listener and
 * autoscaling, which keeps the IaC surface small. The tradeoff, accepted
 * deliberately for staging and rejected for production, is that the public
 * hostname is a random `*.ecs.<region>.on.aws` name with no custom-domain
 * parameter, and it changes on every recreate.
 *
 * This stack is ADDITIVE. It creates new `-cdk`-suffixed services alongside the
 * original hand-built `carrieros-web-staging` / `carrieros-mcp-staging` and
 * shares no mutable resource with them:
 *   - The two pre-existing IAM roles are imported with `mutable: false`, so CDK
 *     cannot add a policy to a role the hand-built services also run as.
 *   - Log groups, the task security group and the services themselves are all
 *     new, distinctly-named resources.
 *   - The Secrets Manager secrets are referenced read-only by ARN; no duplicate
 *     secret is created and no secret value appears in this repo.
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import type { EnvironmentConfig, ServiceConfig } from '../config/types';

export interface StagingStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
  readonly vpc: ec2.IVpc;
  readonly serviceSubnetIds: readonly string[];
  readonly taskSecurityGroup: ec2.ISecurityGroup;
  /**
   * The MCP service's own public origin.
   *
   * This cannot be derived inside the stack on a first deploy: it is the MCP
   * Express Gateway service's own `Endpoint` attribute, and a CloudFormation
   * resource cannot `GetAtt` itself. Pass it on a second deploy via
   * `--context mcpPublicUrl=https://<endpoint>` once the endpoint is known.
   * Left unset, OAuth-based MCP clients are unavailable but the
   * header-credential path (`x-carrieros-client-id` / `-client-secret`) works,
   * which is what the deployment verification exercises.
   */
  readonly mcpPublicUrl?: string;
}

/** Maps the CDK log-retention enum from a plain day count in config. */
function retentionFromDays(days: number): logs.RetentionDays {
  const byDays: Record<number, logs.RetentionDays> = {
    1: logs.RetentionDays.ONE_DAY,
    3: logs.RetentionDays.THREE_DAYS,
    5: logs.RetentionDays.FIVE_DAYS,
    7: logs.RetentionDays.ONE_WEEK,
    14: logs.RetentionDays.TWO_WEEKS,
    30: logs.RetentionDays.ONE_MONTH,
    60: logs.RetentionDays.TWO_MONTHS,
    90: logs.RetentionDays.THREE_MONTHS,
    180: logs.RetentionDays.SIX_MONTHS,
    365: logs.RetentionDays.ONE_YEAR,
  };
  const match = byDays[days];
  if (!match) {
    throw new Error(
      `logRetentionDays=${days} is not a CloudWatch-supported retention period. Supported: ${Object.keys(byDays).join(', ')}.`,
    );
  }
  return match;
}

export class StagingStack extends cdk.Stack {
  /** Public hostname of the web service (no scheme). */
  public readonly webEndpoint: string;
  /** Public hostname of the MCP service (no scheme). */
  public readonly mcpEndpoint: string;

  constructor(scope: Construct, id: string, props: StagingStackProps) {
    super(scope, id, props);

    const { config, serviceSubnetIds, taskSecurityGroup } = props;

    if (config.albStrategy !== 'express-gateway') {
      throw new Error(
        `StagingStack requires albStrategy 'express-gateway', got '${config.albStrategy}'.`,
      );
    }
    if (!config.iam.infrastructureRoleArn) {
      throw new Error(
        'Express Gateway requires config.iam.infrastructureRoleArn (the role ECS uses to manage the ALB it provisions).',
      );
    }

    // Imported read-only. `mutable: false` is the guardrail that stops this
    // stack from ever attaching a policy to a role the pre-existing hand-built
    // staging services also use. The existing execution role's
    // `secretsmanager:GetSecretValue` is already scoped to the whole
    // `carrieros-staging/*` prefix, so the new services can read the same
    // secrets with no policy change at all.
    const executionRole = iam.Role.fromRoleArn(
      this,
      'ExecutionRole',
      config.iam.executionRoleArn,
      { mutable: false },
    );
    const infrastructureRole = iam.Role.fromRoleArn(
      this,
      'InfrastructureRole',
      config.iam.infrastructureRoleArn,
      { mutable: false },
    );

    const cluster = `arn:aws:ecs:${config.region}:${config.account}:cluster/${config.clusterName}`;
    const retention = retentionFromDays(config.logRetentionDays);

    /** Builds one Express Gateway service plus its log group. */
    const buildService = (
      key: 'web' | 'mcp',
      service: ServiceConfig,
      environment: Record<string, string>,
    ): ecs.CfnExpressGatewayService => {
      // CDK owns the log group so retention is actually managed. Left to ECS,
      // the group is created implicitly with "never expire".
      const logGroup = new logs.LogGroup(this, `${key}LogGroup`, {
        logGroupName: `/aws/ecs/${config.clusterName}/${service.serviceName}`,
        retention,
        // Staging logs are disposable; keeping the group after a stack
        // teardown would leave an orphan CDK can no longer manage.
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const image = `${config.account}.dkr.ecr.${config.region}.amazonaws.com/${service.ecrRepositoryName}:${service.imageTag}`;

      const expressService = new ecs.CfnExpressGatewayService(this, `${key}Service`, {
        serviceName: service.serviceName,
        cluster,
        infrastructureRoleArn: infrastructureRole.roleArn,
        executionRoleArn: executionRole.roleArn,
        cpu: service.cpu,
        memory: service.memory,
        healthCheckPath: service.healthCheckPath,
        networkConfiguration: {
          subnets: [...serviceSubnetIds],
          securityGroups: [taskSecurityGroup.securityGroupId],
        },
        primaryContainer: {
          image,
          containerPort: service.containerPort,
          awsLogsConfiguration: {
            logGroup: logGroup.logGroupName,
            logStreamPrefix: 'ecs',
          },
          environment: Object.entries(environment).map(([name, value]) => ({
            name,
            value,
          })),
          secrets: Object.entries(service.secretArns).map(([name, valueFrom]) => ({
            name,
            valueFrom,
          })),
        },
        scalingTarget: {
          minTaskCount: config.minTaskCount,
          maxTaskCount: config.maxTaskCount,
          // The only metric Express Gateway autoscaling supports here. Note
          // this is exactly why minTaskCount: 0 never recovers — CPU is
          // unmeasurable with zero tasks running.
          autoScalingMetric: 'AVERAGE_CPU',
          autoScalingTargetValue: config.autoScalingTargetCpuPercent,
        },
        tags: [
          { key: 'Environment', value: config.envName },
          { key: 'ManagedBy', value: 'cdk' },
          { key: 'Service', value: key },
        ],
      });

      // The service writes to the group, so the group must exist first.
      expressService.node.addDependency(logGroup);

      return expressService;
    };

    // --- web ---
    const web = buildService('web', config.services.web, {
      ...config.services.web.environment,
    });

    // --- mcp ---
    // CARRIEROS_BASE_URL points at THIS stack's own web service, not the
    // hand-built one, so the CDK environment is genuinely self-contained.
    // Both talk to the same staging Supabase project (same image, same
    // secrets), so the data is identical either way.
    const mcpEnvironment: Record<string, string> = {
      ...config.services.mcp.environment,
      CARRIEROS_BASE_URL: `https://${web.attrEndpoint}`,
    };
    if (props.mcpPublicUrl) {
      mcpEnvironment.MCP_PUBLIC_URL = props.mcpPublicUrl;
    }

    const mcp = buildService('mcp', config.services.mcp, mcpEnvironment);

    this.webEndpoint = web.attrEndpoint;
    this.mcpEndpoint = mcp.attrEndpoint;

    new cdk.CfnOutput(this, 'WebUrl', {
      value: `https://${web.attrEndpoint}`,
      description: 'CDK-managed staging web service URL',
    });
    new cdk.CfnOutput(this, 'McpUrl', {
      value: `https://${mcp.attrEndpoint}`,
      description: 'CDK-managed staging MCP service URL (POST /mcp)',
    });
    new cdk.CfnOutput(this, 'WebServiceArn', {
      value: web.attrServiceArn,
      description: 'Used by scripts/staging-pause.sh and staging-resume.sh',
    });
    new cdk.CfnOutput(this, 'McpServiceArn', {
      value: mcp.attrServiceArn,
      description: 'Used by scripts/staging-pause.sh and staging-resume.sh',
    });
    new cdk.CfnOutput(this, 'McpPublicUrlStatus', {
      value: props.mcpPublicUrl
        ? `set: ${props.mcpPublicUrl}`
        : 'unset — redeploy with --context mcpPublicUrl=https://<McpUrl> to enable OAuth clients',
      description: 'Two-phase MCP_PUBLIC_URL state',
    });
  }
}
