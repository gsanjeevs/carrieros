# Deployment and environments

Full authoritative reference: `architecture/deployment.md` — this doc
summarizes it for the team walkthrough and adds a real worked example from
an actual staging deploy run on 2026-09-28/29. If the two ever disagree,
`architecture/deployment.md` wins (it gets updated as the real deploy
process evolves).

## Environments today

| | Database | Web | Mobile |
|---|---|---|---|
| **local** | `supabase start` (Docker) | `next dev` | Expo dev server |
| **staging** | Supabase project `ddwgnsheafuuzzepqxsf` | AWS ECS Express Mode | not yet pointed at staging |
| **production** | not set up | not set up | not set up |

Production deliberately doesn't exist yet — staging was proven working
end-to-end first. `carrieros-web` runs as a **container**
(`carrieros-web/Dockerfile`, multi-stage, Next.js `output: "standalone"`),
not a serverless platform — chosen to stay entirely on AWS (ECS Express Mode
over App Runner, which is EOL for new customers, and over Amplify Hosting,
which doesn't support Next.js 16's managed SSR yet).

## Staging deploy is manual today — here's what actually happens

There's no CI/CD pipeline deploying the app yet. `.github/workflows/deploy.yml`
runs migrations automatically on push (safe, no AWS credentials needed) but
does **not** deploy the container — that step was deliberately left manual to
avoid setting up GitHub OIDC trust roles.

**The real command sequence** (from `carrieros-web/`), the same one used for
a real deploy today:

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS \
  --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

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

# Verify it actually took effect — don't just trust the two commands above returning success.
node carrieros-web/scripts/check-staging-drift.mjs
```

`--platform linux/amd64` is required on Apple Silicon — Fargate is x86_64,
and a plain `docker build` on an M-series Mac produces an arm64 image that
fails to pull.

### Why the verification step exists — a real gotcha

Pushing a new image to the same `:latest` tag does **not** by itself replace
the running ECS task — the tag string in the service config is unchanged, so
nothing tells ECS a new image exists. `update-express-gateway-service` must
be re-run every time (even with an identical `--primary-container` value) to
register a new service deployment and actually roll the task over. This bit
the team on 2026-09-27: several hours of fixes sat pushed to `main`, CI-green,
and completely undeployed without anyone noticing — which is exactly why
`check-staging-drift.mjs` (compares `origin/main` against the running
container's own `/api/version`) exists. Never treat "the AWS command
returned success" as proof the new code is live.

### What a real deploy run looks like

A staging deploy on 2026-09-28/29 confirmed the full sequence works and
takes roughly 5-9 minutes end-to-end, most of it the ECS **canary rollout**
(5% production traffic → bake for 3 minutes → 100%, with an automatic
rollback alarm watching for failures):

```
$ node scripts/check-staging-drift.mjs
DRIFT: staging is running fdf5e10ecd49 (built 2026-09-27T17:03:24Z), but
origin/main is at 1426ef33308a -- staging is 74 commit(s) behind.

# ...build, push, update-express-gateway-service...
# ...poll `aws ecs describe-service-deployments` until status: SUCCESSFUL...

$ node scripts/check-staging-drift.mjs
UP TO DATE: staging is running origin/main's HEAD (d55bba1fa062), built
2026-09-29T06:16:44Z.
```

Worth noting for the team: new commits can land on `main` *while* a deploy
is running (other sessions/branches actively merging) — that's not a
conflict, it just means staging is immediately behind again and needs
another deploy cycle. This is expected on an actively-developed repo, not a
bug in the process.

## One-time setup already done for staging (don't redo this)

1. **Supabase** — project `ddwgnsheafuuzzepqxsf`, all migrations applied,
   seeded with demo data matching local dev
   (`node carrieros-web/scripts/seed-staging-demo.mjs`).
2. **AWS** — ECR repo `carrieros-web`, 2 IAM roles
   (`carrieros-ecsTaskExecutionRole`, `carrieros-ecsInfrastructureRole`), a
   default VPC, Express service `carrieros-web-staging` in the `default`
   cluster.
3. **Secrets** — `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` live in AWS
   Secrets Manager (`carrieros-staging/*`), referenced by ARN — never passed
   as literal values through chat or committed anywhere.
4. **GitHub `staging` Environment** — holds `DATABASE_URL` for the migration
   step only.

## What runs automatically today

- **`.github/workflows/ci.yml`** (every push to `main`/PR) — web
  lint+typecheck+architecture/token checks, mobile typecheck+Jest, and an
  integration job that starts a real local Supabase stack, applies
  migrations, verifies them, builds the web app, and runs the full Vitest
  suite.
- **`.github/workflows/deploy.yml`** — migration-only: applies pending
  migrations against `DATABASE_URL` (a `staging` GitHub Environment secret).
  Does not deploy the app.

## What's explicitly not set up yet

- **Production** — no second Supabase project, no second ECS service, no
  approval-gate environment. Deliberately deferred until staging's proven
  out further.
- **Auto-deploy on push** — a real path (AWS CodeBuild + a GitHub
  connection, console-driven OAuth-style setup, no hand-wired IAM roles) has
  been discussed and agreed as the next step, not built yet.
- **Mobile → staging** — `EXPO_PUBLIC_API_URL` still points at local dev;
  `eas.json`'s `REPLACE_WITH_*` values are still placeholders.
- **Email (SMTP)** — anything that sends email (e.g. customer-portal
  invites) fails at that step on staging today.
- **Error tracking (Sentry)** — SDK wired but inert, no DSN set.
- **`POST /api/cron/send-reminders` has no scheduler** — AWS EventBridge
  Scheduler is the natural fit, not chosen/built yet.
- **No rollback automation** — roll the ECS service back to a prior image
  tag manually; fix schema issues forward with a new migration (there are
  deliberately no down-migrations).

## See also

- `architecture/deployment.md` — the full, authoritative version of this
  doc, kept up to date as the deploy process evolves.
- [05-database-and-migrations.md](./05-database-and-migrations.md) — how
  schema changes reach staging automatically via `deploy.yml`.
