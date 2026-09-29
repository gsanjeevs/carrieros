# Deployment

Two environments so far: **local -> staging**. Production does not exist yet (deliberately —
staging was proven working end-to-end first; see `.claude/memory/project_ecs_express_staging_deploy_2026_09_20.md`
for how it was built and the real gotchas hit along the way).

| | Database | Web | Mobile |
|---|---|---|---|
| local | `supabase start` (Docker) | `next dev` | Expo dev server |
| staging | Supabase project `ddwgnsheafuuzzepqxsf` | AWS ECS Express Mode | not yet pointed at staging |
| production | not set up | not set up | not set up |

`carrieros-web` runs as a **container** (`Dockerfile`, multi-stage, `output: "standalone"`), not on a
serverless hosting platform — this project moved off an earlier managed-hosting plan mid-build because
the account owner wanted to stay entirely on AWS and avoid hand-wiring IAM/OIDC for a CI-driven deploy
to a third party. ECS Express Mode was chosen over the (now EOL-for-new-customers, since 2026-04-30)
App Runner and over Amplify Hosting (doesn't support Next.js 16's managed SSR yet, only up to 15).

## Current state: staging auto-deploys on push to main (2026-09-29)

**AWS CodeBuild + a GitHub connection** now builds and deploys every push to `main` automatically —
see "Auto-deploy pipeline" below for how it's wired. `.github/workflows/deploy.yml` still separately
runs migrations only (safe, no AWS credentials needed); it does not touch the app container, and
that's fine — CodeBuild's `buildspec.yml` doesn't run migrations either, so the two are complementary,
not overlapping.

The manual sequence below still works and is useful for a one-off out-of-band deploy (e.g. testing a
local branch that isn't pushed yet), but it's no longer the normal path. From `carrieros-web/`:

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
docker buildx build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://ddwgnsheafuuzzepqxsf.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key, not secret> \
  --build-arg NEXT_PUBLIC_APP_URL=https://ca-aa167deb702e4a338c4370ff70576195.ecs.us-east-1.on.aws \
  --build-arg BUILD_SHA=$(git rev-parse HEAD) \
  --build-arg BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  -t <account-id>.dkr.ecr.us-east-1.amazonaws.com/carrieros-web:latest --push .
aws ecs update-express-gateway-service \
  --service-arn arn:aws:ecs:us-east-1:<account-id>:service/default/carrieros-web-staging \
  --primary-container '{"image":"<account-id>.dkr.ecr.us-east-1.amazonaws.com/carrieros-web:latest","containerPort":3000}' \
  --region us-east-1

# Verify it actually took effect -- don't just trust the two commands above returning success.
node carrieros-web/scripts/check-staging-drift.mjs
```

**A real gotcha hit on 2026-09-27**: pushing a new image to the same `:latest` tag does NOT by
itself replace the running ECS task -- the tag string in the service config is unchanged, so nothing
tells ECS a new image exists. `update-express-gateway-service` must be re-run (even with the exact
same `--primary-container` value as before) every time, which registers a new service deployment and
actually rolls the task over. `aws ecs describe-service-deployments --service-deployment-arns
<currentDeployment ARN from describe-express-gateway-service>` shows real rollout progress (old task
draining, new task starting) -- the two commands above returning success only means they were
*accepted*, not that staging is actually serving the new code yet. This is exactly why
`check-staging-drift.mjs` (compares `origin/main` against the running container's own
`/api/version`) exists -- it was built the same day this bit someone, after several hours' worth of
fixes sat pushed to `main`, CI-green, and completely undeployed without anyone noticing.

`--platform linux/amd64` is required on Apple Silicon — Fargate is x86_64 and a plain `docker build`
here produces an arm64 image that fails to pull.

## Auto-deploy pipeline (built 2026-09-29)

**CodeBuild project:** `carrieros-web-staging-deploy` (us-east-1). Source is a GitHub connection
(`sx-github`, a CodeConnections/GitHub-App-based connection with access to all repos on the account —
earlier narrower connections scoped to just `carrieros` repeatedly hit an opaque
`OAuthProviderException: User is not authorized to access connection` at `CreateProject` time despite
showing `AVAILABLE` and having confirmed repo access; recreating with broader scope was what actually
resolved it, so the root cause may have been installation-state related rather than repo-scope
related — worth knowing if this ever needs rebuilding). Runs `buildspec.yml` (repo root) on every
push to `main` via an `ACTIVE` GitHub webhook (`EVENT=PUSH`, `HEAD_REF=^refs/heads/main$`).

**What `buildspec.yml` does**: ECR login → `docker build` (native x86_64 in CodeBuild, no
`--platform`/buildx needed) with the same build-args as the manual flow → push to ECR →
`aws ecs update-express-gateway-service`. It deliberately does **not** poll the canary rollout to
completion (see the gotcha above) — verify with `check-staging-drift.mjs` after a build finishes, same
as after a manual deploy.

**Service role**: `carrieros-codebuild-staging-deploy`, least-privilege. Two non-obvious permissions
required beyond the obvious ECR/logs ones, both found by an actual failed test build rather than
guessed up front:
- `ecs:RegisterTaskDefinition` + `ecs:DescribeTaskDefinition` — `update-express-gateway-service`
  registers a new task definition revision internally, so `UpdateExpressGatewayService` alone isn't
  enough.
- `iam:PassRole` on `carrieros-ecsTaskExecutionRole` and `carrieros-ecsInfrastructureRole` — needed to
  pass those roles to the new task definition revision.
- `codeconnections:GetConnection` + `codeconnections:GetConnectionToken` (plus `UseConnection`) — the
  connection auth needs these on the *service role*, not just the calling IAM principal.

**Config that isn't secret but also isn't hardcoded**: `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable)
comes from SSM Parameter Store (`/carrieros/staging/NEXT_PUBLIC_SUPABASE_ANON_KEY`) via buildspec's
`parameter-store` env block, so rotating it doesn't need a `buildspec.yml` change.

**One setting that silently breaks `CreateProject`**: `source.reportBuildStatus: true` requires the
GitHub App to have commit-status write permission. Without it, `CreateProject` itself fails with the
same generic `OAuthProviderException` as a genuine connection/auth problem — indistinguishable from
the outside. It's set to `false` here. If commit statuses on PRs/pushes become wanted later, that
needs the GitHub App's permission scope extended first, not just a flag flip.

## What runs automatically today

- **`.github/workflows/ci.yml`** (every push to `main`/PR): web lint + typecheck + architecture/token
  checks; mobile typecheck + Jest; an integration job that starts a real local Supabase stack, applies
  migrations, runs `scripts/db/verify-migrations.mjs`, builds and starts the web app, runs the full
  Vitest suite. **Genuinely green on GitHub** (confirmed 2026-09-21 — this was not true before then;
  a real npm-version lockfile bug had to be fixed first, see `.claude/memory/project_ci_first_green_2026_09_20.md`).
- **`.github/workflows/deploy.yml`**: migration-only right now (see above) — applies pending
  migrations against `DATABASE_URL` (a `staging` GitHub Environment secret). Does not deploy the app.

## One-time setup already done for staging

1. **Supabase**: project `ddwgnsheafuuzzepqxsf` created, all 24 migrations applied, seeded with demo
   data matching local dev (`node carrieros-web/scripts/seed-staging-demo.mjs`).
   **Passkeys/WebAuthn**: the checked-in `supabase/config.toml` is local-only and sets RP ID/origin to
   `localhost`. Staging uses the hosted Supabase project, so configure its Auth WebAuthn settings
   separately: RP ID `ca-aa167deb702e4a338c4370ff70576195.ecs.us-east-1.on.aws` and allowed origin
   `https://ca-aa167deb702e4a338c4370ff70576195.ecs.us-east-1.on.aws`. A browser origin mismatch is
   rejected by WebAuthn before app code can complete registration/sign-in. Verify this setting in
   the Supabase project before claiming passkeys work on staging; production will need its own RP
   settings when that environment exists.
2. **AWS**: ECR repo `carrieros-web`, 2 IAM roles (`carrieros-ecsTaskExecutionRole`,
   `carrieros-ecsInfrastructureRole` — the latter needed an extra inline policy beyond AWS's own
   documented managed policy, see the memory file linked above), a new default VPC (the account had
   none), Express service `carrieros-web-staging` in the `default` cluster.
3. **Secrets**: `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` live in AWS Secrets Manager
   (`carrieros-staging/*`), referenced by ARN in the ECS task/GitHub Environment — never passed as
   literal values through chat or committed anywhere.
4. **GitHub `staging` Environment**: exists, holds `DATABASE_URL` for the migration step.

## Not set up yet

- **Production** — no second Supabase project, no second ECS service, no approval-gate environment.
  Deliberately deferred until staging's been used for a while.
- **Mobile** — `carrieros-mobile`'s `EXPO_PUBLIC_API_URL` still points at local dev, not staging.
  `eas init` hasn't been run; `carrieros-mobile/eas.json`'s `REPLACE_WITH_*` values are still placeholders.
- **Email (SMTP)** — deliberately deferred; staging has no SMTP configured, so anything that sends an
  email (e.g. the customer-portal invite flow) will fail at that step. Confirmed via the Playwright
  suite (`PLAYWRIGHT_BASE_URL=<staging url> npx playwright test`) — 5/6 passing, the 6th fails only on
  this gap.
- **Error tracking (Sentry)** — deliberately deferred; the web SDK is wired but inert with no DSN set.
- **`POST /api/cron/send-reminders` has no scheduler.** AWS EventBridge Scheduler hitting this route
  (with `Authorization: Bearer $CRON_SECRET`) is the natural fit now that the app runs on ECS, not
  chosen/built yet.
- **No rollback automation** — roll the ECS service back to a prior image tag manually, fix the
  schema forward with a new migration (there are deliberately no down migrations).
- **Mobile store submission** (`eas submit`) is not wired into CI.
