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
serverless platform — this project moved off an original Vercel plan mid-build because the account
owner wanted to stay on AWS and avoid hand-wiring IAM/OIDC for a CI-driven deploy. ECS Express Mode
was chosen over the (now EOL-for-new-customers, since 2026-04-30) App Runner and over Amplify Hosting
(doesn't support Next.js 16's managed SSR yet, only up to 15).

## Current state: staging deploy is manual, not automated

There is no CI/CD pipeline actually deploying anything yet — `.github/workflows/deploy.yml` runs
migrations automatically (safe, no AWS credentials needed) but does **not** deploy the app; that
step was deliberately never wired to avoid making the account owner set up GitHub OIDC trust roles
they didn't want to hand-configure. Getting a new build to staging today means, from `carrieros-web/`:

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
docker buildx build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://ddwgnsheafuuzzepqxsf.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key, not secret> \
  --build-arg NEXT_PUBLIC_APP_URL=https://ca-aa167deb702e4a338c4370ff70576195.ecs.us-east-1.on.aws \
  -t <account-id>.dkr.ecr.us-east-1.amazonaws.com/carrieros-web:latest --push .
aws ecs update-express-gateway-service \
  --service-arn arn:aws:ecs:us-east-1:<account-id>:service/default/carrieros-web-staging \
  --primary-container '{"image":"<account-id>.dkr.ecr.us-east-1.amazonaws.com/carrieros-web:latest","containerPort":3000}' \
  --region us-east-1
```

`--platform linux/amd64` is required on Apple Silicon — Fargate is x86_64 and a plain `docker build`
here produces an arm64 image that fails to pull.

## A real auto-deploy path exists, not yet built

Discussed and agreed with the account owner as the next step when they want it: **AWS CodeBuild +
a GitHub connection**. This is console-driven, not IAM-role hand-wiring — CodeBuild's "Connect to
GitHub" flow is a real OAuth-style authorization (install the "AWS Connector for GitHub" app, pick
the repo), then CodeBuild needs a `buildspec.yml` (not written yet) to build/push the image and a
webhook to trigger on push. Until this exists, staging only updates when someone runs the manual
steps above.

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
- **Auto-deploy on push** — see "A real auto-deploy path exists" above.
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
