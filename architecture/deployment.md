# Deployment

Three environments, one path: **local -> staging -> production**.

| | Database | Web | Mobile |
|---|---|---|---|
| local | `supabase start` (Docker) | `next dev` | Expo dev server |
| staging | Supabase project "carrieros-staging" | Vercel *Preview* target | EAS profile `staging` (internal distribution) |
| production | Supabase project "carrieros-prod" | Vercel *Production* target | EAS profile `production` |

## What runs automatically

- **`.github/workflows/ci.yml`** (every PR and push to `main`): web lint +
  typecheck + architecture/token checks; mobile typecheck + Jest; and an
  integration job that starts a real local Supabase stack, applies migrations
  through `scripts/db/migrate.mjs`, runs `scripts/db/verify-migrations.mjs`,
  builds and starts the web app, and runs the full Vitest suite.
- **`.github/workflows/deploy.yml`** (after CI passes on `main`, or manually):
  for each environment, **migrate the database first, then deploy the app**,
  then smoke-test `/login`. Staging is automatic; production waits for approval.
  Migrations must stay expand/contract-safe so the previous app version works
  against the new schema during the gap (see `database-migrations.md`).

Neither workflow has been run on GitHub yet; every step in `ci.yml` was
exercised locally first. The deploy workflow has not been exercised at all
(it needs the setup below), so expect a first-run fix or two.

## One-time setup (needs an account owner)

1. **Supabase**: create two projects (staging, prod). Copy each project's
   *direct* Postgres connection string (Settings -> Database; use the
   non-pooled one, migrations need session semantics) and its API URL, anon
   key and service-role key.
2. **Vercel**: create one project rooted at `carrieros-web`. Set the env vars
   from `carrieros-web/.env.example` for **Preview** (staging values) and
   **Production** separately.
3. **GitHub -> Settings -> Environments**: create `staging` and `production`.
   In each add secrets `DATABASE_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
   `VERCEL_PROJECT_ID`. On `production`, add *Required reviewers*: that is
   the approval gate.
4. **Branch protection** on `main`: require the `CI` jobs to pass before merge.
   This is what makes CI enforcement rather than advice.
5. **Mobile**: `eas init`, then replace the `REPLACE_WITH_*` values in
   `carrieros-mobile/eas.json`. Store the anon key as an EAS environment
   variable (`EXPO_PUBLIC_SUPABASE_ANON_KEY`) per profile.
6. **Email**: set `SMTP_*` for staging and production (local uses Mailpit).
7. **Error tracking**: create a Sentry project, set `SENTRY_DSN` and
   `NEXT_PUBLIC_SENTRY_DSN` (and `SENTRY_ENVIRONMENT`) per Vercel environment.
   Add `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` to enable source-map
   upload. With no DSN the web SDK is inert. Mobile has only a logging seam
   (`src/lib/observability.ts`); installing `@sentry/react-native` needs a
   native rebuild and is a separate step.

## Not covered yet

- `POST /api/cron/send-reminders` has no scheduler. Vercel Cron issues `GET`,
  so either add a `GET` handler or point an external scheduler at it with
  `Authorization: Bearer $CRON_SECRET`.
- No rollback automation: roll the app back in Vercel, fix the schema forward
  with a new migration (there are deliberately no down migrations).
- Mobile store submission (`eas submit`) is not wired into CI.
