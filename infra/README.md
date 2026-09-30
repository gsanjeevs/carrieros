# `infra/` — CarrierOS infrastructure as code (AWS CDK v2, TypeScript)

One CDK app deploys either environment. `--context env=staging|production` picks a
config file; the config's `albStrategy` picks which stack class runs. There is no
other branching.

For the rationale behind the staging/production split and the full list of what is
still manual, read `architecture/infrastructure-as-code.md` at the repo root.

## Layout

```
infra/
  bin/deploy.ts            app entrypoint; reads --context env=
  config/
    types.ts               the environment-constraint contract
    staging.ts             staging constraint values (real AWS ids)
    production.ts          production constraint values (placeholders where a domain is needed)
  lib/
    network-stack.ts       reuses the existing default VPC; owns the security groups
    ecr-stack.ts           retention policies on the EXISTING carrieros-web / carrieros-mcp repos
    staging-stack.ts       CfnExpressGatewayService-based web + mcp
    production-stack.ts    custom ALB + target groups + FargateService web + mcp  (NOT DEPLOYED)
```

Stacks are named `CarrierOS-<env>-Network`, `-Ecr`, `-Services`.

## Setup

```bash
cd infra
npm install
```

CDK needs a one-time bootstrap per account/region before the first deploy:

```bash
npx cdk bootstrap aws://308855860393/us-east-1
```

## Commands

Safe to run unattended — read-only, no AWS mutation:

```bash
cd infra
npx tsc --noEmit                          # typecheck
npx cdk synth  --context env=staging      # render templates
npx cdk synth  --context env=production
npx cdk diff   --context env=staging      # needs credentials; still read-only
```

Mutates real AWS — needs review before running:

```bash
npx cdk deploy --context env=staging --all
```

Never run:

```bash
npx cdk deploy --context env=production   # see the banner in lib/production-stack.ts
```

## What is safe unattended vs. what needs a human

| Command | Safe unattended | Why |
|---|---|---|
| `tsc --noEmit`, `cdk synth` | yes | pure local render; no credentials, no API calls |
| `cdk diff` | yes | read-only; describes drift against deployed state |
| `cdk deploy --context env=staging` | **no** | creates/replaces real ECS services and load balancers |
| `scripts/staging-pause.sh` | yes | idempotent scale-to-zero; only touches `-cdk` services |
| `scripts/staging-resume.sh` | yes | idempotent scale-to-one; only touches `-cdk` services |
| `cdk deploy --context env=production` | **never** | no production environment exists; would create unwanted billable resources |
| `cdk destroy` (any env) | **no** | the account owner decides teardown |

## Secrets discipline

This directory contains **secret ARNs and IAM grants, never secret values.**

- Staging **reuses** the five existing `carrieros-staging/*` secrets by exact ARN
  (`config/staging.ts`). No duplicate secret is created.
- The pre-existing task execution role is imported with `mutable: false`, so CDK
  cannot attach a policy to a role the original hand-built staging services also
  run as. It already has `secretsmanager:GetSecretValue` scoped to the whole
  `carrieros-staging/*` prefix, so the new services need no policy change.
- Production creates its **own** roles and secret *resources*.
  `PUBLIC_API_JWT_SECRET` and `MCP_OAUTH_ENCRYPTION_KEY` are app-generated random
  values, so CDK generating them is correct. `SUPABASE_SERVICE_ROLE_KEY` is a
  deliberate empty placeholder that must be populated out-of-band from a
  production Supabase project that does not exist yet.

## Two-phase `MCP_PUBLIC_URL`

The MCP container wants `MCP_PUBLIC_URL` set to its own public origin. On a first
deploy that value cannot exist: it is the MCP Express Gateway service's own
`Endpoint` attribute, and a CloudFormation resource cannot `GetAtt` itself — that
is a circular reference CloudFormation rejects.

So the first deploy leaves it unset, and a second deploy supplies it:

```bash
# 1. First deploy; read the endpoint out of the stack output.
npx cdk deploy --context env=staging --all

# 2. Feed it back in.
npx cdk deploy --context env=staging --all \
  --context mcpPublicUrl=https://<McpUrl from step 1>
```

With it unset, OAuth-based MCP clients (dynamic client registration) are
unavailable, but the per-request header credential path
(`x-carrieros-client-id` / `x-carrieros-client-secret`) works — which is what the
deployment verification exercises. `CARRIEROS_BASE_URL` has no such problem: it
points at the *sibling* web service and flows through normally.

## Why `fromVpcAttributes` instead of `Vpc.fromLookup`

`fromLookup` calls AWS at synth time and caches the answer in `cdk.context.json`.
That makes `cdk synth` require credentials, makes synth output depend on
machine-local cache state, and drifts silently when the cache goes stale. The real
VPC and subnet ids are pinned in `config/*.ts` instead, so synth is deterministic,
offline, and visible in a diff. The ids were read off the live account, not
guessed — the commands used are listed in a comment at the top of
`config/staging.ts`.

The tradeoff, stated plainly: if the default VPC's subnets ever change, these
files must be updated by hand. `cdk diff` will not catch that, because CDK is no
longer asking AWS what the subnets are.

## Why ECR retention uses a custom resource

Both ECR repositories already exist and hold the images staging serves.
`new ecr.Repository(...)` would try to create them and fail;
`Repository.fromRepositoryName(...)` returns a handle with no `addLifecycleRule`,
because an imported repository is not under CloudFormation's management. So
`ecr-stack.ts` calls `PutLifecyclePolicy` through an `AwsCustomResource`. The API
replaces the policy wholesale, so repeat deploys converge instead of accumulating
rules. There is deliberately no `onDelete`: removing the stack should stop CDK
managing retention, not silently disable retention on repositories that outlive it.
