/**
 * production-stack.ts — the production environment: a custom ALB + target
 * groups + listener in front of standard `ecs.FargateService`s.
 *
 * ############################################################################
 * # NOT DEPLOYED. This stack is code-complete and `cdk synth`-clean only.    #
 * # There is no production Supabase project, no registered domain, and no    #
 * # production secrets with real values. `cdk deploy` here would create real #
 * # billable resources for an environment that does not otherwise exist.     #
 * ############################################################################
 *
 * Why this does NOT use Express Gateway like staging does:
 *   1. Custom domain. Express Gateway exposes no domain/hostname parameter at
 *      all; every service gets a random `*.ecs.<region>.on.aws` name, and a
 *      recreate changes it. Production needs a stable hostname.
 *   2. WAF. A WebACL association needs a load balancer ARN this stack owns.
 *   3. Blue/green control. Owning the target groups and listener is what makes
 *      a controlled shift possible rather than an opaque managed rollout.
 *
 * Deferred, and deliberately not faked here — see
 * `architecture/infrastructure-as-code.md`:
 *   - ACM certificate + HTTPS:443 listener + HTTP->HTTPS redirect. Requires a
 *     registered domain; ACM cannot validate a domain nobody owns. The listener
 *     below is HTTP:80 so the stack is synthesizable and complete in shape.
 *   - Route53 hosted zone + alias record. Same reason.
 *   - SES domain verification (SPF/DKIM/DMARC). Same reason.
 *   - CodeDeploy-driven blue/green. A deployment circuit breaker with automatic
 *     rollback is wired; a full CodeDeploy traffic-shifting deployment group is
 *     the next step and needs a release process decision first.
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';
import type { EnvironmentConfig, ServiceConfig } from '../config/types';

export interface ProductionStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
  readonly vpc: ec2.IVpc;
  readonly serviceSubnetIds: readonly string[];
  readonly taskSecurityGroup: ec2.ISecurityGroup;
  /**
   * The ALB's security group, owned by the network stack. See the comment on
   * `NetworkStack.albSecurityGroup` for why it is not created here.
   */
  readonly albSecurityGroup: ec2.ISecurityGroup;
}

function retentionFromDays(days: number): logs.RetentionDays {
  const byDays: Record<number, logs.RetentionDays> = {
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
    throw new Error(`logRetentionDays=${days} is not a supported CloudWatch retention period.`);
  }
  return match;
}

export class ProductionStack extends cdk.Stack {
  public readonly loadBalancerDnsName: string;

  constructor(scope: Construct, id: string, props: ProductionStackProps) {
    super(scope, id, props);

    const { config, vpc, serviceSubnetIds, taskSecurityGroup } = props;

    if (config.albStrategy !== 'custom-alb') {
      throw new Error(
        `ProductionStack requires albStrategy 'custom-alb', got '${config.albStrategy}'.`,
      );
    }
    if (!config.domainName) {
      throw new Error(
        'ProductionStack requires config.domainName (a placeholder is acceptable; it drives host-based routing).',
      );
    }
    if (config.minTaskCount < 2) {
      throw new Error(
        `Production minTaskCount must be at least 2 for real HA, got ${config.minTaskCount}.`,
      );
    }

    const retention = retentionFromDays(config.logRetentionDays);
    const subnets = serviceSubnetIds.map((subnetId, i) =>
      ec2.Subnet.fromSubnetId(this, `Subnet${i}`, subnetId),
    );
    const vpcSubnets: ec2.SubnetSelection = { subnets };

    // Reuse the account's existing ECS cluster.
    const cluster = ecs.Cluster.fromClusterAttributes(this, 'Cluster', {
      clusterName: config.clusterName,
      vpc,
      securityGroups: [],
    });

    // --- IAM: production-specific roles ---------------------------------------
    // Deliberately NOT shared with staging. A future widening of a staging
    // policy must not be able to grant production access.
    const executionRole = new iam.Role(this, 'ExecutionRole', {
      roleName: `carrieros-ecsTaskExecutionRole-${config.envName}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'CarrierOS production ECS task execution role (pull images, read secrets, write logs)',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
      ],
    });

    // --- Secrets --------------------------------------------------------------
    // Resources and IAM only. No secret VALUE appears in this repo.
    //
    // PUBLIC_API_JWT_SECRET and MCP_OAUTH_ENCRYPTION_KEY are app-generated
    // random values, so CDK generating them is correct and complete.
    // SUPABASE_SERVICE_ROLE_KEY comes from the (nonexistent) production
    // Supabase project: the resource is created, and the value MUST be
    // populated out-of-band before first deploy.
    const jwtSecret = new secretsmanager.Secret(this, 'PublicApiJwtSecret', {
      secretName: `carrieros-${config.envName}/PUBLIC_API_JWT_SECRET`,
      description: 'Production public developer API JWT signing secret (generated)',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const mcpOauthKey = new secretsmanager.Secret(this, 'McpOauthEncryptionKey', {
      secretName: `carrieros-${config.envName}/MCP_OAUTH_ENCRYPTION_KEY`,
      description: 'Production MCP OAuth token encryption key (generated). Rotating it invalidates all client registrations and tokens.',
      generateSecretString: { passwordLength: 44, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // TODO(requires a production Supabase project): populate this value
    // out-of-band (`aws secretsmanager put-secret-value`) before first deploy.
    // The generated placeholder is deliberately not a usable key.
    const supabaseServiceRoleKey = new secretsmanager.Secret(
      this,
      'SupabaseServiceRoleKey',
      {
        secretName: `carrieros-${config.envName}/SUPABASE_SERVICE_ROLE_KEY`,
        description:
          'PLACEHOLDER — must be populated out-of-band from the production Supabase project before first deploy.',
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      },
    );

    for (const secret of [jwtSecret, mcpOauthKey, supabaseServiceRoleKey]) {
      secret.grantRead(executionRole);
    }

    // --- Load balancer --------------------------------------------------------
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      loadBalancerName: `carrieros-${config.envName}`,
      vpc,
      vpcSubnets,
      internetFacing: true,
      securityGroup: props.albSecurityGroup,
      // Real HA: spread across every AZ that has a subnet (albAzCount: 'all').
      deletionProtection: true,
    });
    this.loadBalancerDnsName = alb.loadBalancerDnsName;

    const listener = alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      // Anything not matching a host rule below is refused rather than
      // silently served by whichever target group happens to be default.
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: 'text/plain',
        messageBody: 'Unknown host',
      }),
    });

    // --- Services -------------------------------------------------------------
    const buildService = (
      key: 'web' | 'mcp',
      service: ServiceConfig,
      hostHeader: string,
      priority: number,
      secrets: Record<string, ecs.Secret>,
      environment: Record<string, string>,
    ): ecs.FargateService => {
      const logGroup = new logs.LogGroup(this, `${key}LogGroup`, {
        logGroupName: `/aws/ecs/${config.clusterName}/${service.serviceName}`,
        retention,
        // Production logs outlive the stack on purpose.
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      });

      const taskDefinition = new ecs.FargateTaskDefinition(this, `${key}TaskDef`, {
        family: `carrieros-${key}-${config.envName}`,
        cpu: Number(service.cpu),
        memoryLimitMiB: Number(service.memory),
        executionRole,
        runtimePlatform: {
          // Fargate x86_64 — the images are built for linux/amd64.
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });

      taskDefinition.addContainer(`${key}Container`, {
        containerName: key,
        // `fromEcrRepository`, not `fromRegistry`: passing an ECR URI as a plain
        // registry string does NOT grant the execution role pull permission, so
        // the task would fail to start with an authorization error at runtime.
        image: ecs.ContainerImage.fromEcrRepository(
          ecr.Repository.fromRepositoryName(
            this,
            `${key}EcrRepository`,
            service.ecrRepositoryName,
          ),
          service.imageTag,
        ),
        portMappings: [{ containerPort: service.containerPort }],
        environment,
        secrets,
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'ecs', logGroup }),
      });

      const fargateService = new ecs.FargateService(this, `${key}Service`, {
        serviceName: service.serviceName,
        cluster,
        taskDefinition,
        desiredCount: config.minTaskCount,
        securityGroups: [taskSecurityGroup],
        vpcSubnets,
        // Public subnets with no NAT gateway: a public IP is required to reach
        // ECR and Secrets Manager. A dedicated VPC with private subnets + NAT
        // is the deferred improvement noted in the architecture doc.
        assignPublicIp: true,
        circuitBreaker: { enable: true, rollback: true },
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        enableExecuteCommand: false,
      });

      const targetGroup = new elbv2.ApplicationTargetGroup(this, `${key}TargetGroup`, {
        vpc,
        port: service.containerPort,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
        targets: [fargateService],
        deregistrationDelay: cdk.Duration.seconds(30),
        healthCheck: {
          path: service.healthCheckPath,
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
        },
      });

      listener.addAction(`${key}Rule`, {
        priority,
        conditions: [elbv2.ListenerCondition.hostHeaders([hostHeader])],
        action: elbv2.ListenerAction.forward([targetGroup]),
      });

      const scaling = fargateService.autoScaleTaskCount({
        minCapacity: config.minTaskCount,
        maxCapacity: config.maxTaskCount,
      });
      scaling.scaleOnCpuUtilization(`${key}CpuScaling`, {
        targetUtilizationPercent: config.autoScalingTargetCpuPercent,
        scaleInCooldown: cdk.Duration.minutes(5),
        scaleOutCooldown: cdk.Duration.minutes(1),
      });

      return fargateService;
    };

    const webHost = config.domainName;
    const mcpHost = `mcp.${config.domainName}`;

    buildService(
      'web',
      config.services.web,
      webHost,
      10,
      {
        PUBLIC_API_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
        SUPABASE_SERVICE_ROLE_KEY: ecs.Secret.fromSecretsManager(supabaseServiceRoleKey),
      },
      { ...config.services.web.environment },
    );

    buildService(
      'mcp',
      config.services.mcp,
      mcpHost,
      20,
      { MCP_OAUTH_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(mcpOauthKey) },
      {
        ...config.services.mcp.environment,
        // Stable custom domains, so unlike staging these are known at synth
        // time and need no second deploy.
        CARRIEROS_BASE_URL: `https://${webHost}`,
        MCP_PUBLIC_URL: `https://${mcpHost}`,
      },
    );

    // --- WAF ------------------------------------------------------------------
    if (config.wafEnabled) {
      const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
        name: `carrieros-${config.envName}`,
        scope: 'REGIONAL',
        defaultAction: { allow: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `carrieros-${config.envName}-waf`,
          sampledRequestsEnabled: true,
        },
        rules: [
          {
            name: 'AWSManagedRulesCommonRuleSet',
            priority: 1,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesCommonRuleSet',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'CommonRuleSet',
              sampledRequestsEnabled: true,
            },
          },
          {
            name: 'AWSManagedRulesKnownBadInputsRuleSet',
            priority: 2,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesKnownBadInputsRuleSet',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'KnownBadInputs',
              sampledRequestsEnabled: true,
            },
          },
          {
            name: 'RateLimitPerIp',
            priority: 3,
            action: { block: {} },
            statement: {
              rateBasedStatement: { limit: 2000, aggregateKeyType: 'IP' },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'RateLimitPerIp',
              sampledRequestsEnabled: true,
            },
          },
        ],
      });

      new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
        resourceArn: alb.loadBalancerArn,
        webAclArn: webAcl.attrArn,
      });
    }

    // --- Outputs --------------------------------------------------------------
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
      description: 'ALB hostname. A Route53 alias from the real domain points here once one is registered.',
    });
    new cdk.CfnOutput(this, 'ExpectedWebHost', {
      value: webHost,
      description: 'PLACEHOLDER domain — no Route53/ACM resources are provisioned for it',
    });
    new cdk.CfnOutput(this, 'ExpectedMcpHost', {
      value: mcpHost,
      description: 'PLACEHOLDER domain — no Route53/ACM resources are provisioned for it',
    });
    new cdk.CfnOutput(this, 'AutoDeployPolicy', {
      value: config.autoDeployOnPushToMain
        ? 'auto-deploy on push to main'
        : 'manual promote only — push to main must NOT change production',
      description: 'Delivery policy for this environment',
    });
    new cdk.CfnOutput(this, 'SesStatus', {
      value: `${config.sesMode} — TODO: requires a registered domain; no SES identity is created by this stack`,
      description: 'Email posture',
    });
  }
}
