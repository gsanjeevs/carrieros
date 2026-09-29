# CarrierOS architecture walkthrough

This is a guided tour of the codebase for the development and QA team,
written to be read together with the code open — every doc here cites real
`file_path:line_number` locations, not paraphrased summaries. It complements,
rather than replaces, the existing `architecture/` docs (ADRs, ERD, migration
guide, deployment guide) — each walkthrough doc links out to the relevant
ones instead of duplicating them.

## Suggested session order

If you're running this as a live walkthrough, this order builds context
progressively — later docs assume you've seen the earlier ones:

1. **[01-platform-overview.md](./01-platform-overview.md)** — the whole
   system in one page: what runs where, the two apps + shared database, the
   hard architectural rules the team enforces mechanically (not just by
   convention), and the demo accounts/seed data you'll use to follow along.
2. **[02-domain-application-layer.md](./02-domain-application-layer.md)** —
   `carrieros-web/server/`: where business rules actually live, and why
   they're deliberately isolated from Supabase/HTTP.
3. **[03-api-and-public-api.md](./03-api-and-public-api.md)** — how a
   request reaches that business logic: internal `/api/v1` routes, the
   legacy pre-v1 routes still being migrated, and the separate public
   developer API third parties (including our own `carrieros-mcp` project)
   use.
4. **[04-auth-and-authorization.md](./04-auth-and-authorization.md)** — who's
   making a request, how tenant isolation is enforced, and the SuperAdmin
   path — required reading before writing any test that touches multiple
   orgs.
5. **[05-database-and-migrations.md](./05-database-and-migrations.md)** —
   the Postgres/Supabase schema, how migrations are written and verified,
   and how to reset/seed data locally or on staging.
6. **[06-mobile-app.md](./06-mobile-app.md)** — the Expo/React Native driver
   app: screens, the API client, and current offline-handling reality.
7. **[07-deployment-and-environments.md](./07-deployment-and-environments.md)**
   — local vs staging vs production (production doesn't exist yet), and how
   to actually get a change live on staging today.

## What's deliberately not duplicated here

- **Full ERD** — see `architecture/erd.md`.
- **ADR rationale** — see `architecture/adr/`; walkthrough docs cite specific
  ADRs rather than re-explaining them.
- **Line-by-line migration history** — see `architecture/database-migrations.md`
  and `architecture/inventory/database-inventory.md`.
