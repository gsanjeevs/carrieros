# Deployment

Two environments so far: **local -> staging**. Production does not exist yet (deliberately —
staging was proven working end-to-end first; see `.claude/memory/project_ecs_express_staging_deploy_2026_09_20.md`
for how it was built and the real gotchas hit along the way).

| | Database | Web | Mobile |
|---|---|---|---|
| local | `supabase start` (Docker) | `next dev` | Expo dev server |
| staging | Supabase project `ddwgnsheafuuzzepqxsf` | AWS ECS Express Mode | `eas.json`'s `staging` profile points at staging; no EAS project registered yet |
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
3. **Secrets**: `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, and `PUBLIC_API_JWT_SECRET` live in AWS
   Secrets Manager (`carrieros-staging/*`), referenced by ARN in the ECS task/GitHub Environment —
   never passed as literal values through chat or committed anywhere. `carrieros-ecsTaskExecutionRole`
   has `secretsmanager:GetSecretValue` scoped to the whole `carrieros-staging/*` prefix (not one ARN
   at a time) specifically so a new secret doesn't need a matching IAM policy edit to actually work —
   learned the hard way on 2026-09-29 when `PUBLIC_API_JWT_SECRET` was added to the task but the role
   was still scoped to only the original `SUPABASE_SERVICE_ROLE_KEY` ARN, and the public API silently
   500'd with "Public API is not configured" until the policy was widened.
   **`PUBLIC_API_JWT_SECRET` was missing entirely until 2026-09-29** — the public developer API
   (`/api/public/v1/*`) had been built and documented as working, but staging's ECS task never
   actually had this env var set, so every real call 500'd. Caught while verifying `carrieros-mcp`'s
   hosted deployment against real staging data — worth knowing that "the code is built and staging is
   deployed" didn't mean this specific feature actually worked on staging until it was checked with a
   real request, not just a passing build.
4. **GitHub `staging` Environment**: exists, holds `DATABASE_URL` for the migration step.
5. **Email (SMTP), built 2026-09-29**: real outbound email now works on staging end-to-end (magic-link
   invites via Supabase Auth's `admin.inviteUserByEmail`, e.g. the customer-portal contact-invite flow
   — plus anything the app itself sends through `lib/send-email.ts`). No Route53 hosted zone or
   registered domain existed on the AWS account (`aws route53 list-hosted-zones` / `list-domains` both
   empty), so this uses SES's no-domain-needed path — a single verified sender identity — rather than
   full domain verification:
   - **SES** (`us-east-1`, account `308855860393`): verified sender identity `sanjeev@shipmentx.com`
     (`aws sesv2 create-email-identity --email-identity sanjeev@shipmentx.com`; AWS emails a
     verification link to that address — someone has to click it, there's no CLI/API way around that
     one step). Also requested production access off the sandbox
     (`aws sesv2 put-account-details --mail-type TRANSACTIONAL --production-access-enabled ...`) —
     this matters even with a verified sender: SES sandbox mode restricts the *recipient* too (only
     verified addresses or the mailbox simulator), which would have blocked the invite flow's
     `e2e-contact-<timestamp>@example.com`-style recipients regardless of sender verification. The
     request went through review and came back `ProductionAccessEnabled: true`
     (`aws sesv2 get-account --region us-east-1`) — no fixed SLA on that from AWS, so don't assume
     it's instant if this ever needs redoing.
   - **IAM**: a dedicated user `carrieros-ses-smtp-staging` (least-privilege inline policy: only
     `ses:SendRawEmail`, condition-scoped to `ses:FromAddress = sanjeev@shipmentx.com`) with an access
     key converted to SES SMTP credentials via AWS's documented HMAC-SHA256 signing algorithm (SMTP
     username = access key ID, SMTP password derived from the secret key — not the secret key itself).
     Stored in AWS Secrets Manager as `carrieros-staging/SMTP_CREDENTIALS`, same pattern as the other
     `carrieros-staging/*` secrets — never passed as literal values through chat or committed anywhere.
   - **Supabase Auth config**: pushed via `supabase config push --project-ref ddwgnsheafuuzzepqxsf`
     from a *scratch* `supabase/config.toml` (declaring only `[auth.email.smtp]` and
     `[auth.rate_limit] email_sent`, nothing else) rather than editing the checked-in
     `supabase/config.toml` — that file is local-only (see the Passkeys/WebAuthn note above) and is
     shared with local dev's Mailpit-based email flow, so committing real SES creds into it would have
     pointed local dev at real SES too. `config push` only touches properties a given file actually
     declares (confirmed with `supabase config diff` first), so a minimal one-off file is enough:
     `host = "email-smtp.us-east-1.amazonaws.com"`, `port = 587`, `user`/`pass` from
     `env(...)`-referenced shell vars (never written to disk), `admin_email = "sanjeev@shipmentx.com"`.
     Also had to raise `auth.rate_limit.email_sent` from the local default of `2`/hour (fine for a dev
     stack nobody actually emails) to `30`/hour (matching this config's other `/hour` rate limits) —
     GoTrue enforces that limit the moment SMTP is enabled, and the first real test run tripped it with
     a `"email rate limit exceeded"` 500 from the invite route.
   - **Verified against the actual target, not just config that looks right**: re-ran the previously
     failing spec — `PLAYWRIGHT_BASE_URL=https://ca-aa167deb702e4a338c4370ff70576195.ecs.us-east-1.on.aws
     npx playwright test e2e/customer-contacts.spec.ts` — now passes (invite click resolves to
     "Linked"/"Revoke access", confirming GoTrue's send actually succeeded against real SES). Full
     suite is 5/6 against staging as of this writing; the 6th (`e2e/loads.spec.ts`) fails on an
     unrelated load-creation timeout, not email.

## Not set up yet

- **Production** — no second Supabase project, no second ECS service, no approval-gate environment.
  Deliberately deferred until staging's been used for a while.
- **Mobile — EAS project registration (2026-09-29)**: `carrieros-mobile/eas.json`'s `staging` build
  profile now points `EXPO_PUBLIC_API_URL` at `https://ca-aa167deb702e4a338c4370ff70576195.ecs.us-east-1.on.aws`
  (the same staging ECS gateway the web app uses) and `EXPO_PUBLIC_SUPABASE_URL` at
  `https://ddwgnsheafuuzzepqxsf.supabase.co` (the same staging Supabase project) — the local `.env`
  default (`http://localhost:3000` / local Supabase) is untouched, so `expo start` still targets local
  dev by default. `eas init` has **not** been run — `eas whoami` on this machine returned "Not logged
  in", and `eas login` needs an interactive browser/credential flow no agent session can complete, so
  no EAS project has been registered and `expo.extra.eas.projectId` doesn't exist yet in `app.json`.
  Whoever does have EAS credentials should run `eas login` then `eas init` from `carrieros-mobile/`
  (idempotent — safe to run once) before the `staging`/`production` build profiles can actually be
  used with `eas build`. Note `eas.json`'s `staging` profile also has no
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` — it isn't in the file at all yet, not just a placeholder — so that
  still needs to be supplied via an EAS environment variable (or added to the profile) before a real
  staging build can authenticate against Supabase. `production`'s `REPLACE_WITH_*` values are left
  untouched — no production Supabase project or web URL exists yet (see above).
- **Error tracking (Sentry)** — deliberately deferred; the web SDK is wired but inert with no DSN set.
- **`POST /api/cron/send-reminders` has no scheduler.** AWS EventBridge Scheduler hitting this route
  (with `Authorization: Bearer $CRON_SECRET`) is the natural fit now that the app runs on ECS, not
  chosen/built yet.
- **No rollback automation** — roll the ECS service back to a prior image tag manually, fix the
  schema forward with a new migration (there are deliberately no down migrations).
- **Mobile store submission** (`eas submit`) is not wired into CI.
