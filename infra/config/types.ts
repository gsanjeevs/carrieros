/**
 * types.ts — the environment-constraint contract.
 *
 * One CDK app deploys either environment; everything that differs between
 * staging and production is a value in here, not a branch in stack code
 * (the only intentional exception is the ALB strategy itself — see
 * `albStrategy` below and `architecture/infrastructure-as-code.md` for why
 * staging and production genuinely need different constructs).
 */

/** How the environment gets an ALB in front of its tasks. */
export type AlbStrategy =
  /**
   * ECS Express Gateway (`AWS::ECS::ExpressGatewayService`) auto-provisions the
   * ALB, target group, listener and autoscaling. Less IaC surface, but the
   * public hostname is a random `*.ecs.<region>.on.aws` name that changes on
   * every recreate — there is no custom-domain parameter on the resource.
   */
  | 'express-gateway'
  /**
   * Custom ALB + target group + listener + a standard `ecs.FargateService`.
   * More IaC surface, but required for a stable custom domain, a WAF
   * association, and finer blue/green control.
   */
  | 'custom-alb';

/** SES posture. Full domain verification needs a registered domain. */
export type SesMode =
  /** A single verified sender identity — SES's no-domain-needed path. */
  | 'single-sender'
  /** Full domain verification (SPF/DKIM/DMARC). Requires a registered domain. */
  | 'domain-verification';

/**
 * Number of availability zones to spread the load balancer across.
 * `'all'` means every AZ that has a subnet in the VPC (real HA).
 * A number pins it (2 is the AWS minimum for an ALB).
 */
export type AzCount = number | 'all';

/** A single subnet in the reused VPC. */
export interface SubnetConfig {
  readonly subnetId: string;
  readonly availabilityZone: string;
}

/** Network constraints — an existing VPC that CDK reuses and never creates. */
export interface NetworkConfig {
  readonly vpcId: string;
  /** The VPC's CIDR, used to scope task security-group ingress. */
  readonly vpcCidrBlock: string;
  /**
   * Public subnets, in a stable order. `albAzCount` selects a prefix of this
   * list, so the order here is load-bearing — reordering it moves a
   * deployed service's subnets.
   */
  readonly publicSubnets: readonly SubnetConfig[];
}

/** One deployable container service (web or mcp). */
export interface ServiceConfig {
  /** ECS service name. Must be unique in the cluster. */
  readonly serviceName: string;
  /** Existing ECR repository name — CDK references it, never creates it. */
  readonly ecrRepositoryName: string;
  /** Image tag to deploy. */
  readonly imageTag: string;
  readonly containerPort: number;
  /** Path the load balancer health-checks. Must return 2xx with no auth. */
  readonly healthCheckPath: string;
  /** Fargate task size, as the strings the ECS API expects. */
  readonly cpu: string;
  readonly memory: string;
  /**
   * Plain (non-secret) container environment variables.
   * Values that are only known after a sibling service is deployed (for
   * example an Express Gateway endpoint) are injected by the stack, not here.
   */
  readonly environment: Readonly<Record<string, string>>;
  /**
   * Secret env vars: container env var name -> Secrets Manager secret ARN.
   * ARNs only. Never a secret *value* — see the secrets discipline note in
   * `infra/README.md`.
   */
  readonly secretArns: Readonly<Record<string, string>>;
}

/** IAM roles the tasks run as. Reused, not created, where they already exist. */
export interface IamConfig {
  /** Pulls images and reads secrets. */
  readonly executionRoleArn: string;
  /**
   * Express-Gateway-only: the role ECS uses to manage the ALB/target
   * group/listener it provisions on your behalf.
   */
  readonly infrastructureRoleArn?: string;
  /** Optional in-container task role. Omitted means no task role. */
  readonly taskRoleArn?: string;
}

/** Everything that differs between staging and production. */
export interface EnvironmentConfig {
  readonly envName: 'staging' | 'production';
  readonly account: string;
  readonly region: string;
  /** ECS cluster name. Both environments use the account's `default` cluster. */
  readonly clusterName: string;

  readonly network: NetworkConfig;
  readonly iam: IamConfig;

  readonly albStrategy: AlbStrategy;

  // --- Scaling ---
  /**
   * Minimum running tasks.
   *
   * A real, load-bearing gotcha for `express-gateway`: its autoscaling is
   * CPU-based (`AVERAGE_CPU`), and CPU cannot be measured on zero tasks, so
   * there is no request-triggered cold start. A service left at
   * `minTaskCount: 0` with no traffic stays at zero and the gateway returns 503
   * indefinitely — nothing can scale it back up on its own.
   *
   * That is exactly why staging runs at 1 rather than 0: zero would have meant
   * "staging is down until a human runs a script". `scripts/staging-pause.sh`
   * sets 0 on demand to park it; `scripts/staging-resume.sh` restores this
   * configured value.
   */
  readonly minTaskCount: number;
  readonly maxTaskCount: number;
  readonly autoScalingTargetCpuPercent: number;

  // --- Load balancer ---
  readonly albAzCount: AzCount;

  // --- Guardrails / retention ---
  readonly wafEnabled: boolean;
  readonly logRetentionDays: number;
  readonly ecrKeepLastImages: number;

  // --- Delivery ---
  /**
   * `true` keeps the current CodeBuild push-to-main behavior.
   * Production is deliberately `false`: promotion must be an explicit manual
   * step, not an implicit consequence of merging.
   */
  readonly autoDeployOnPushToMain: boolean;

  // --- Email ---
  readonly sesMode: SesMode;
  /** The verified sender, for `single-sender`. */
  readonly sesSenderIdentity?: string;
  /** The domain to verify, for `domain-verification`. */
  readonly sesDomain?: string;

  // --- Custom domain ---
  /**
   * Stable public hostname. `undefined` keeps the generated
   * `*.ecs.<region>.on.aws` name. Production requires one, but no domain is
   * registered yet, so this is a placeholder and no Route53/ACM resources are
   * provisioned against it — see `architecture/infrastructure-as-code.md`.
   */
  readonly domainName?: string;

  readonly services: {
    readonly web: ServiceConfig;
    readonly mcp: ServiceConfig;
  };
}
