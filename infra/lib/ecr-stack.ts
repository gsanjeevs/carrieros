/**
 * ecr-stack.ts — image-retention lifecycle policies for the EXISTING
 * `carrieros-web` and `carrieros-mcp` ECR repositories.
 *
 * Why a custom resource instead of an L2 `ecr.Repository`:
 * both repositories already exist and hold the images staging is currently
 * serving. `new ecr.Repository(...)` would try to CREATE them and fail with
 * `RepositoryAlreadyExistsException`, and `Repository.fromRepositoryName(...)`
 * returns an `IRepository` with no `addLifecycleRule` — an imported repository
 * is not under CloudFormation's management, so CloudFormation cannot express a
 * policy on it. `PutLifecyclePolicy` via an `AwsCustomResource` is the
 * non-destructive way to manage retention on a repository CDK does not own:
 * the API is idempotent (it replaces the policy wholesale), so repeated deploys
 * converge rather than accumulate.
 *
 * Deliberately no `onDelete`: tearing this stack down removes CDK's management
 * of the retention policy, but must not silently turn retention off on
 * repositories that outlive the stack.
 */

import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/types';

export interface EcrStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
}

export class EcrStack extends cdk.Stack {
  /** The existing repositories, referenced by name (never created here). */
  public readonly repositories: Record<'web' | 'mcp', ecr.IRepository>;

  constructor(scope: Construct, id: string, props: EcrStackProps) {
    super(scope, id, props);

    const { config } = props;
    const keepLast = config.ecrKeepLastImages;

    if (!Number.isInteger(keepLast) || keepLast < 1) {
      throw new Error(`ecrKeepLastImages must be a positive integer, got ${keepLast}`);
    }

    const lifecyclePolicyText = JSON.stringify({
      rules: [
        {
          rulePriority: 1,
          description: `Expire all but the ${keepLast} most recent images`,
          selection: {
            tagStatus: 'any',
            countType: 'imageCountMoreThan',
            countNumber: keepLast,
          },
          action: { type: 'expire' },
        },
      ],
    });

    const repos: Partial<Record<'web' | 'mcp', ecr.IRepository>> = {};

    for (const key of ['web', 'mcp'] as const) {
      const repositoryName = config.services[key].ecrRepositoryName;

      const repository = ecr.Repository.fromRepositoryName(
        this,
        `${key}Repository`,
        repositoryName,
      );
      repos[key] = repository;

      new AwsCustomResource(this, `${key}LifecyclePolicy`, {
        // Re-runs whenever the policy text or the repository name changes,
        // and is a no-op otherwise.
        onUpdate: {
          service: 'ECR',
          action: 'putLifecyclePolicy',
          parameters: {
            repositoryName,
            lifecyclePolicyText,
          },
          physicalResourceId: PhysicalResourceId.of(
            `${repositoryName}-lifecycle-keep-${keepLast}`,
          ),
        },
        policy: AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ecr:PutLifecyclePolicy', 'ecr:GetLifecyclePolicy'],
            resources: [repository.repositoryArn],
          }),
        ]),
        installLatestAwsSdk: false,
      });

      new cdk.CfnOutput(this, `${key}RepositoryUriOutput`, {
        value: repository.repositoryUri,
        description: `Existing ECR repository for ${key} (retention: keep last ${keepLast})`,
      });
    }

    this.repositories = repos as Record<'web' | 'mcp', ecr.IRepository>;
  }
}
