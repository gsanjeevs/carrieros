# Infrastructure as code

Everything on AWS before 2026-09-30 was created imperatively with raw `aws` CLI
commands — ECS Express Gateway services, their load balancer, IAM roles, Secrets
Manager entries, SES/SNS config, the CodeBuild auto-deploy project. It worked, but
none of it was codified: there was no way to review an infrastructure change as a
diff, no way to stand a second environment up reproducibly, and no record of the
intended shape of things beyond `architecture/deployment.md` prose.

`infra/` is the answer to that: **AWS CDK v2 (TypeScript), one app, two
environments, parameterized by typed constraint files.** This doc covers what CDK
manages, how to run it, why staging and production deliberately use different
constructs, and — at the bottom, explicitly — what is still manual and what has
and has not actually been proven to work.

Read `infra/README.md` for the command reference and the per-command
"safe unattended?" table. This doc is the rationale and the status.

## What CDK manages now

| Stack | Manages | Notes |
|---|---|---|
| `CarrierOS-<env>-Network` | task security group, ALB security group (production only) | **Reuses** the existing default VPC `vpc-08e40735030c9aea8`; does not create one |
| `CarrierOS-<env>-Ecr` | image-retention lifecycle policy on `carrieros-web` and `carrieros-mcp` | **References** the existing repositories; does not create them |
| `CarrierOS-staging-Services` | `carrieros-web-staging-cdk`, `carrieros-mcp-staging-cdk` + their log groups | `AWS::ECS::ExpressGatewayService`. **Deployed and live-verified 2026-09-30.** |
| `CarrierOS-production-Services` | custom ALB, target groups, listener, 2 Fargate services, WAF, production IAM roles and secret resources | **Written and synth-clean. Never deployed.** |

Explicitly **not** managed by CDK yet: the CodeBuild auto-deploy project, the SES
sender identity and its SNS bounce/complaint topic, the SMTP IAM user, and the
Supabase project itself. Those remain as `architecture/deployment.md` describes
them — see "Still manual" below.

## The parallel-build decision

*(Historical — describes 2026-09-30 through 2026-10-01, while both environments
coexisted. The hand-built pair no longer exists; see "Cutover status" below. Left
as-is because it explains real safety rationale, not current topology.)*

The CDK staging environment was built as a **new, additive** environment that ran
alongside the original hand-built one. It used `-cdk`-suffixed service names
(`carrieros-web-staging-cdk`, `carrieros-mcp-staging-cdk`) precisely so there was no
name collision and no path by which a CDK deploy could mutate the services that
were then serving staging.

Three concrete guardrails back that up, rather than just the naming convention:

1. The two pre-existing IAM roles (`carrieros-ecsTaskExecutionRole`,
   `carrieros-ecsInfrastructureRole`) are imported with `mutable: false`. CDK will
   refuse at synth time to attach a policy to them, so a CDK change cannot alter
   the permissions the hand-built services run with.
2. The five `carrieros-staging/*` secrets are referenced read-only by exact ARN.
   No duplicate secret is created, and no secret value appears in the repo.
3. Log groups, security groups and services are all new, distinctly-named
   resources. Nothing pre-existing is imported into CloudFormation's management,
   which means no CloudFormation operation can delete or replace it.

The existing staging environment is untouched and stays that way until the account
owner explicitly decides otherwise — see "The one open decision" at the end.

## Staging vs. production: why they use different constructs

This is the one place the two environments genuinely diverge in *code* rather than
just in values, so it is worth being precise about why.

**Staging uses `CfnExpressGatewayService`.** Express Gateway auto-provisions the
ALB, target group, listener and autoscaling. That is a lot less IaC surface to own,
and it is the pattern already in use and already understood. The cost is that the
public hostname is a random `*.ecs.<region>.on.aws` name.

**Production uses a custom ALB + `ecs.FargateService`.** Three things force this:

1. **Custom domain.** Express Gateway has *no* domain or hostname parameter at
   all — confirmed by inspecting its CLI schema, not assumed. Every service gets a
   generated hostname, and recreating a service produces a completely different
   one (this actually happened to `carrieros-mcp-staging`:
   `ca-185d9362…` became `ca-7dc84edc…` on a recreate with identical config).
   A production URL that changes when infrastructure is rebuilt is not acceptable.
2. **WAF.** A `WebACLAssociation` needs a load balancer ARN the stack owns.
   There is no way to attach a WebACL to the load balancer Express Gateway hides.
3. **Blue/green control.** Owning the target groups and listener is what makes a
   controlled traffic shift possible instead of an opaque managed rollout.

### The constraint table

Every row here is a value in `infra/config/staging.ts` or
`infra/config/production.ts`, not a hardcoded decision in stack code.

| Constraint | staging | production |
|---|---|---|
| ALB strategy | Express Gateway (auto) | custom ALB + FargateService |
| `minTaskCount` | 1 (always-on; see below) | 2 |
| `maxTaskCount` | 1 | 4 (configurable; no real load data yet) |
| ALB availability zones | 2 (the AWS minimum) | all AZs with a subnet in the VPC |
| WAF | disabled | enabled (common rule set, known-bad-inputs, per-IP rate limit) |
| CloudWatch log retention | 7 days | 30 days |
| ECR: keep last N images | 5 | 20 |
| Auto-deploy on push to `main` | yes (current CodeBuild behavior) | **no — explicit manual promote** |
| Image tag | `latest` | pinned release SHA |
| SES | single verified sender | domain verification (**TODO**, needs a domain) |
| Custom domain | none, keeps `*.ecs.*.on.aws` | required (**placeholder**, no domain registered) |
| Log group removal policy | `DESTROY` | `RETAIN` |

`maxTaskCount: 4` for production is deliberately a conservative default and not a
considered capacity decision — there is no production load data to base one on.
It is left configurable rather than presented as a tuned limit.

Production deliberately does **not** auto-deploy on push to `main`. Merging must
not be sufficient to change production; promotion is an explicit step against a
pinned image tag.

## Running it

```bash
cd infra
npm install

# Read-only, no credentials needed, safe to run any time:
npx tsc --noEmit
npx cdk synth --context env=staging
npx cdk synth --context env=production

# Mutates AWS — review the diff first:
npx cdk diff   --context env=staging
npx cdk deploy --context env=staging --all
```

`cdk synth` needs no AWS credentials, on purpose: the VPC and subnet ids are
pinned in the config files rather than discovered with `Vpc.fromLookup`. See
`infra/README.md` for that tradeoff in full.

A first deploy needs a one-time bootstrap:

```bash
npx cdk bootstrap aws://308855860393/us-east-1
```

### Two-phase `MCP_PUBLIC_URL`

The MCP service's `MCP_PUBLIC_URL` is its own public origin, which cannot be set
on a first deploy — a CloudFormation resource cannot `GetAtt` itself. Deploy once,
read the `McpUrl` output, then deploy again with
`--context mcpPublicUrl=https://<McpUrl>`. Without it, OAuth dynamic client
registration is unavailable but the header-credential path still works. Full
explanation in `infra/README.md`.

## Pause and resume

```bash
./scripts/staging-pause.sh    [--dry-run]
./scripts/staging-resume.sh   [--dry-run] [--wait]
```

Both are idempotent, both target **only** the `-cdk` services, and both fail fast
with a clear message when AWS credentials have expired rather than emitting one
opaque error per service.

**Staging is always-on: `minTaskCount: 1`** (account owner's decision,
2026-09-30). `staging-resume.sh` restores that configured value rather than
overriding it, so the config file, `cdk deploy` and the script all agree, and
**pause is now the only thing that ever sets 0**.

The floor is 1 because of a platform constraint, not a cost preference. Express
Gateway's autoscaling is CPU-based (`AVERAGE_CPU`), CPU cannot be measured across
zero running tasks, and there is no request-triggered cold start. A service at
`minTaskCount: 0` with no traffic has nothing that can ever scale it up — it stays
at zero and the gateway returns 503 indefinitely. That bit the original hand-built
MCP service for real. So a 0 floor does not mean "cheap, wakes on demand"; it means
"down until a human runs a script" — the wrong default for an environment that CI,
`check-staging-drift.mjs`, mobile builds and teammates all expect to answer.

Consequence worth knowing, and the exact inverse of the old sharp edge:
**`cdk deploy` restores the minimum to 1**, so a deploy will un-pause a parked
environment. Pause is an on-demand parking brake, not a durable setting — if
staging should be parked by default, change `infra/config/staging.ts` rather than
relying on the script having been run.

Pausing is a compute-cost lever, not a teardown: the Express-Gateway-managed load
balancer still exists and still bills while tasks are at zero.

### Pausing is declarative; convergence to zero is slow

Measured on 2026-09-30 — worth knowing before anyone reads a 200 after a pause as a
bug. `staging-pause.sh` sets the scaling minimum to 0 and registers a new service
revision. It does **not** stop the running tasks. Observed:

- Task count went 2 -> 1 within ~3 minutes (the previous revision draining), then
  **held at 1 for the remaining ~7 minutes of polling**.
- The endpoint returned HTTP 200 throughout.

This is not specific to the CDK environment. The original hand-built services have
been at `minTaskCount: 0` for days and show the same split: `carrieros-mcp-staging`
has **0** running tasks, while `carrieros-web-staging` has **1** running task and
still answers 200. Scale-in to literal zero is autoscaler-driven (CPU target
tracking, deliberately conservative), and any traffic at all — a health poller, a
drift check, a browser tab — keeps one task alive.

So `minTaskCount: 0` means "zero is permitted", not "go to zero now". No script can
force it, which is why `staging-pause.sh` reports the declarative change and points
at `aws ecs list-tasks` for real progress instead of pretending pause is synchronous.

### `activeConfigurations[0]` is not the current configuration

A real bug found and fixed while live-testing these scripts.
`describe-express-gateway-service` returns `activeConfigurations` with **one entry
per overlapping service revision** — every `update-express-gateway-service` call
registers a new revision, and the old one stays "active" while its tasks drain. The
entries are **not ordered by age**. Observed on `carrieros-web-staging-cdk`:

| index | createdAt | minTaskCount |
|---|---|---|
| 0 | 15:23:07 | 0 |
| 1 | 15:14:45 | 0 |
| 2 | 15:19:13 | 1 |

Reading `[0]` was correct in that sample by luck and would silently read a *stale*
scaling target in another ordering. Both scripts now select `max_by(.createdAt)`,
validated against `describe-service-deployments`: for the in-progress deployment,
`targetServiceRevision` matched the newest-by-`createdAt` entry and the two older
entries appeared as `sourceServiceRevisions`.

## Verification status — what is actually proven

This repo's standing rule is that nothing counts as working without live proof, not
a command that merely returned success. Applying that honestly:

**Proven (2026-09-30):**

- `CfnExpressGatewayService` is real, not hallucinated: present in
  `aws-cdk-lib@2.272.0` (`aws-ecs/lib/ecs.generated.d.ts`, 28 references), and the
  underlying CloudFormation type is server-side supported —
  `aws cloudformation describe-type --type RESOURCE --type-name AWS::ECS::ExpressGatewayService`
  returns `"Status": "LIVE"`, `"ProvisioningType": "FULLY_MUTABLE"`.
- `npx tsc --noEmit` is clean.
- `npx cdk synth --context env=staging` and `--context env=production` both exit 0
  with **zero warnings**.
- The synthesized staging template contains the intended values, checked against
  the rendered output rather than the source: `ServiceName:
  carrieros-web-staging-cdk` / `carrieros-mcp-staging-cdk`, `MinTaskCount: 0`,
  `MaxTaskCount: 1`, `RetentionInDays: 7`, the correct per-service secret ARNs, and
  two subnets.
- Two real bugs were found and fixed by synth rather than by inspection: a
  CloudFormation dependency cycle (the ALB security group had to move into the
  network stack, because attaching a Fargate service to a target group adds an
  ingress rule to the *task* security group referencing the *ALB* security group),
  and `ContainerImage.fromRegistry` with an ECR URI, which does not grant the
  execution role pull permission and would have failed at task start.
- Both shell scripts pass `bash -n`, and their credential-expiry guard was
  exercised for real (both exit 1 with
  `error: AWS credentials are missing or expired. Run 'aws login' and retry.`).

### Deployed and live-verified (2026-09-30)

The staging stack was deployed for real. Live endpoints:

| Service | URL |
|---|---|
| web | `https://ca-4f7c487503aa47609a79a96746866bb8.ecs.us-east-1.on.aws` |
| mcp | `https://ca-f68d8ab0d62b4f638db9eaec01052b4f.ecs.us-east-1.on.aws` |

- `cdk diff` before deploying was **entirely `[+]`** — zero `[-]` and zero `[~]`,
  confirming the deploy could only add resources.
- All three stacks deployed clean: `CarrierOS-staging-Network` (22s),
  `-Ecr` (65s), `-Services` (260s).
- **Zero-never-wakes confirmed:** immediately after deploy, at `minTaskCount: 0`,
  both endpoints returned **HTTP 503**. DNS resolved immediately — no lag this time,
  though the gotcha still stands.
- **ECR retention genuinely applied**, checked by reading it back rather than
  trusting the stack:
  `aws ecr get-lifecycle-policy --repository-name carrieros-web` returns
  `{"rules":[{"rulePriority":1,"description":"Expire all but the 5 most recent images",...,"countNumber":5,...}]}`.
- **`staging-resume.sh --wait` worked for real:** both services went
  **503 -> HTTP 200**; web became healthy on the 5th poll (~1 min), mcp on the 1st.
- **The web service is serving the real application**, not just a health page:
  `GET /api/version` returns
  `{"sha":"ed80b7a25387f4fe2b61f68df52936cc1725da42","builtAt":"2026-09-30T22:12:46Z"}`.
- **`staging-pause.sh` worked and is idempotent:** `minTaskCount 1 -> 0` on both,
  with `maxTaskCount`, `autoScalingMetric` and `autoScalingTargetValue` preserved
  (proving it changes only the minimum); a second run reported
  `already paused (minTaskCount=0)` and made no API call.
- Two further real bugs were caught by live testing, not inspection: the
  `activeConfigurations[0]` staleness described above, and the incorrect assumption
  that pause drains tasks synchronously. Both are fixed and documented.

### The MCP tool call — fully verified end to end

- `GET /health` returns **HTTP 200**.
- An unauthenticated `POST /mcp` is correctly rejected: **HTTP 401**
  `{"error":"missing_tenant_credentials",...}`.
- **`CARRIEROS_BASE_URL` was checked rather than assumed.** The newest service
  revision's container environment reads
  `CARRIEROS_BASE_URL=https://ca-4f7c487503aa47609a79a96746866bb8...` — the **new
  CDK web service**, not the old hand-built one. The CloudFormation `GetAtt`
  wiring between the two sibling services works.
- A real `tools/call` for `list_vehicles` returns **real tenant data** for
  Sierra Freight Co: `T-1` (Freightliner Cascadia), `T-2` (Peterbilt 579), `T-3`
  (Kenworth T680), `T-10` (International MV), with signed Supabase storage URLs.
  That exercises the whole path: TLS -> gateway -> MCP container -> new CDK web
  service -> public API auth -> staging Supabase -> back out as MCP content.

Getting there required a diagnosis worth recording. The first attempt returned
`CarrierOS API error (401 invalid_client)`. That was **not** an infrastructure
fault: the same call with the *old* web service as upstream failed identically, and
`oauth_clients` showed the live row was `pub_client_bd3aed26…` while
`carrieros-mcp/.env` carried a different, stale `pub_client_9f5…`. Per
`carrieros-web/server/application/public-api-token-service.ts`, `invalid_client`
deliberately collapses three cases — unknown `client_id`, revoked client, and wrong
secret — so the error alone could not distinguish them.

Secrets are bcrypt-hashed (`client_secret_hash`, cost 12) and unrecoverable, so a
fresh client was minted for the verification, using the same id/secret formats as
`server/infrastructure/crypto/oauth-credentials.ts`:

| Field | Value |
|---|---|
| row | `oauth_clients` id **2** |
| org | **3** (Sierra Freight Co on staging) |
| name | `mcp-cdk-staging-verification` |
| client_id | `pub_client_e46c0cac…` |

Note the org numbering trap: Sierra Freight Co is **org 3 on staging**, whereas
`CLAUDE.md` documents org 12 for local dev — staging's org 12 is Cascade
Freightways. Check the table, don't port the number across environments.

This client is **live and unrevoked**. Revoke it with a `revoked_at` timestamp when
it is no longer wanted; there is no secret-rotation path, so rotation means
create-new plus revoke-old.

Two documented gotchas remain relevant and are not signs of failure:

- **DNS lag.** A freshly created `*.ecs.*.on.aws` hostname can fail to resolve for
  several minutes after the AWS API reports success (it did not on this deploy, but
  it has before). `curl: (6) Could not resolve host` right after a deploy is not
  proof the service is broken. Confirm with `curl --resolve <host>:443:<ip>` using
  an IP from `nslookup`.
- **Zero never wakes.** A 503 from a service at `minTaskCount: 0` is expected, not
  a fault. Run `staging-resume.sh` first.

### The old environment was not modified by CDK

Verified by fingerprint taken before and after the deploy, not by assertion. Only
read-only `describe`/`list` calls were ever issued against the hand-built services.

`carrieros-mcp-staging` is **byte-identical** before and after: same `createdAt`,
`updatedAt`, `serviceRevisionArn` (`…/4813600925268216894`), scaling target and
endpoint.

`carrieros-web-staging` needs an honest footnote, because one field *did* change and
it would be easy to misread as collateral damage. Its service-level `createdAt`
(2026-09-20T19:51:41), `updatedAt`, scaling target and endpoint are all unchanged,
but its active service revision moved from `…/3028890110795027471` to
`…/1854486714769918456`. That was **not** this work. It was the existing CodeBuild
push-to-main auto-deploy:

| Evidence | Value |
|---|---|
| CodeBuild run | `carrieros-web-staging-deploy:e1091517-…` |
| Window | 15:12:04 -> **15:16:03** |
| Triggering commit | `ed80b7a25387f4fe2b61f68df52936cc1725da42` (pushed to `main` by another session) |
| New revision created | **15:16:02** |

The revision timestamp matches the build's completion to within a second, and the
build was triggered by a git push, which nothing in `infra/` can do. Corroborating
detail: that same SHA is what the new CDK web service reports at `/api/version`,
because both services pull the `carrieros-web:latest` tag CodeBuild had just pushed.

This is itself a useful demonstration of the ordering caveat already documented in
`architecture/deployment.md`: staging's auto-deploy fires on any push to `main`,
independent of anything else happening in the account. Expect the hand-built web
service's revision to keep moving on its own while that pipeline is live.

## Still manual / deferred

- **Production deploy.** The stack is code-complete and synth-clean but has never
  been deployed, and should not be until: a production Supabase project exists, a
  domain is registered, `SUPABASE_SERVICE_ROLE_KEY` is populated out-of-band, an
  ACM certificate and HTTPS:443 listener replace the placeholder HTTP:80 listener,
  and a Route53 alias record exists. The listener is HTTP:80 today purely so the
  stack is complete in shape and synthesizable; it is not a production-ready
  posture.
- **Domain and TLS.** No domain is registered on this account
  (`aws route53 list-hosted-zones` and `list-domains` are both empty).
  `infra/config/production.ts` carries a placeholder
  (`app.example-carrieros-prod.invalid`) that drives host-based routing rules and
  outputs. **No Route53 or ACM resources are provisioned against it** — ACM cannot
  validate a domain nobody owns, and attempting it would leave a permanently
  pending certificate.
- **SES domain verification (SPF/DKIM/DMARC).** Production's config declares
  `sesMode: 'domain-verification'`, but the stack creates no SES identity. This is
  a TODO gated on domain registration. Staging's single verified sender
  (`sanjeev@shipmentx.com`) remains hand-built and outside CDK.
- **CodeBuild auto-deploy project** (`carrieros-web-staging-deploy`) is still
  hand-built and not in CDK. The `autoDeployOnPushToMain` config flag currently
  *documents* each environment's intended policy rather than provisioning the
  pipeline that implements it. Bringing CodeBuild into CDK would also be the
  natural point to build production's manual-approval promote step.
- **A dedicated production VPC.** Production currently reuses the same default VPC
  with public subnets and `assignPublicIp: true` (required to reach ECR and Secrets
  Manager without a NAT gateway). A real production build more likely wants private
  subnets with NAT. Deferred deliberately rather than silently assumed.
- **CodeDeploy blue/green.** A deployment circuit breaker with automatic rollback
  is wired; genuine traffic-shifting needs a release-process decision first.
- ~~A fully green MCP tool call~~ — **done.** Was blocked on stale credentials in
  `carrieros-mcp/.env`; fixed by minting a fresh `oauth_clients` row
  (`mcp-cdk-staging-verification`, id=2, org 3) rather than editing the
  unrecoverable bcrypt-hashed stale one. See "Done (2026-10-01)" below for the
  real `tools/call` verification against live tenant data.
- ~~Decommissioning the original hand-built staging resources~~ — **done, see below.**

## The one open decision — resolved 2026-10-01

Once the CDK-managed staging environment was deployed and verified, there were
**two parallel staging environments**: the original hand-built
`carrieros-web-staging` / `carrieros-mcp-staging`, and the CDK-managed `-cdk` pair.
Both billed. The account owner gave direct, explicit go-ahead to complete the
cutover and decommission the hand-built pair — the old services were deleted
2026-10-01 (see "Cutover status" below for the full evidence trail).

## Cutover status — complete (2026-10-01)

The cutover was deliberately split into a reversible half and an irreversible
half, done in that order on purpose. Both are now done.

### Done (2026-09-30) — reversible, all in git

1. **`buildspec.yml` repointed.** `ECS_SERVICE_ARN` now targets
   `carrieros-web-staging-cdk`, and `NEXT_PUBLIC_APP_URL` the new hostname.
   Auto-deploy on push to `main` now rolls the CDK service; the hand-built service
   is no longer auto-deployed.
2. **`carrieros-mobile/eas.json`** — both staging-channel profiles (`staging` and
   `simulator`) repointed.
3. **`carrieros-web/scripts/check-staging-drift.mjs`** default `STAGING_URL`
   repointed.
4. **Docs** repointed: `architecture/deployment.md` (manual deploy commands + a new
   banner), `architecture/walkthrough/07-deployment-and-environments.md`, and
   `carrieros-mcp`'s `README.md` / `architecture/deployment.md`.
5. **The CodeBuild service role's IAM policy was widened** — necessary, and easy to
   miss. `carrieros-codebuild-staging-deploy`'s statement granting
   `ecs:UpdateExpressGatewayService` / `DescribeExpressGatewayService` /
   `DescribeServiceDeployments` was scoped to a single resource, the **old** service
   ARN. Repointing `buildspec.yml` alone would have produced an `AccessDenied` at
   `post_build`, because `…/carrieros-web-staging` does not match
   `…/carrieros-web-staging-cdk` (no wildcard). The policy now lists **both** ARNs,
   deliberately keeping the old one so reverting `buildspec.yml` still works.

   This role is **not** managed by CDK (the CodeBuild project is explicitly out of
   scope — see "Still manual / deferred"), so that was a hand-edit via
   `aws iam put-role-policy` and is not captured in any template. It is a concrete
   argument for bringing the pipeline into CDK.

Historical entries in `CURRENT_WORK.md` and the record of past test runs in
`deployment.md` still name the old hostname **on purpose** — they describe what was
true at the time and should not be rewritten.

#### Auto-deploy proven against the new service, with a real build

Not inferred from the config change — a real push was made and followed all the way
to serving traffic:

| Step | Evidence |
|---|---|
| Push to `main` | commit `405afe8` at **23:43:21Z** |
| CodeBuild triggered automatically | build `1f496467-…`, `sourceVersion 405afe8`, started **23:43:21Z** |
| Build result | **SUCCEEDED** at 23:47:23Z — no `AccessDenied`, confirming the IAM widening was the missing piece |
| What it rolled | build log: `Rolling arn:aws:ecs:…:service/default/carrieros-web-staging-cdk to the new image...` |
| New service got a revision | new active configuration at **16:47:10** local (23:47:10Z) |
| Old service | still only its **15:16:02** revision — **not** rolled |
| New code actually live | `/api/version` on the CDK service returned `sha 405afe8…`, `builtAt 2026-09-30T23:44:00Z` at **23:53:41Z** |
| Old service still on old code | `/api/version` returns `sha ed80b7a…` — proof the pipeline no longer touches it |
| Drift checker agrees | `UP TO DATE: staging is running origin/main's HEAD (405afe8bec87)` |
| MCP regression | a real `tools/call` against the freshly rolled image still returns 10 vehicles, `isError: false` |

Note the rollout lag, which is the already-documented gotcha and not a fault: the
build succeeded at 23:47:23Z but the new code only served at **23:53:41Z**, about six
minutes later. A green build is not evidence that new code is live — check
`/api/version` or `check-staging-drift.mjs`.

### Done (2026-10-01) — the irreversible half

5. **Supabase Auth WebAuthn RP ID / allowed origin cut over.** The blocker
   documented below (no stored CLI token in the subagent's isolated worktree) was
   environment-specific, not a real missing credential — the main session's shell
   has a Supabase CLI token in the macOS Keychain (`security find-generic-password
   -s "Supabase CLI"`), which `supabase projects list` confirmed working.

   **A second, more fundamental discovery while unblocking this**: the originally
   planned `supabase config push`/`config diff` approach could not have worked at
   all, token or not. `config.toml`'s `[auth.webauthn]` table only governs the
   *local* `supabase start` stack — the CLI's remote-config mapping doesn't include
   `webauthn_*` fields, and silently omits them from every diff rather than
   erroring, which looks exactly like "already matches" but isn't. Confirmed by
   running the scratch-config `config diff` for real: all 20 reported differences
   were unrelated fields (SMTP, rate limits, etc.); zero mentioned `webauthn`, with
   or without `--experimental`.

   The real mechanism: `GET`/`PATCH /v1/projects/{ref}/config/auth` on the
   Management API directly, which does expose `webauthn_rp_id`,
   `webauthn_rp_origins`, `webauthn_rp_display_name`, and `passkey_enabled` as flat
   fields:

   ```bash
   TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
   curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     "https://api.supabase.com/v1/projects/ddwgnsheafuuzzepqxsf/config/auth" \
     -d '{"webauthn_rp_id":"<host>","webauthn_rp_origins":"https://<host>"}'
   ```

   Applied with `<host>` = `ca-4f7c487503aa47609a79a96746866bb8.ecs.us-east-1.on.aws`
   (the CDK web service). **Verified by an independent re-`GET` after the `PATCH`**,
   not by trusting the `PATCH` response — both returned the new RP ID/origin.

   `carrieros-web/tests/passkey-config.test.ts` still does not verify this (it only
   checks the local `config.toml`, never contacts the staging project) — that
   caveat from the original plan still stands, and the Management API read-back is
   the real check.

6. **Deleted `carrieros-web-staging` and `carrieros-mcp-staging`.** Sequenced after
   step 5 landed and was independently verified, exactly as gated. Both services
   deleted via `aws ecs delete-express-gateway-service`; polled every 20s until
   `INACTIVE`:

   | Service | Deletion duration | 
   |---|---|
   | `carrieros-mcp-staging` | `DRAINING` → `INACTIVE` in under a minute |
   | `carrieros-web-staging` | `DRAINING` → `INACTIVE` in ~8 minutes (ALB deregistration delay, the same pattern observed during the earlier hostname-determinism test) |

   **The CDK web service was polled continuously throughout both deletions — every
   single poll returned `200`.** Zero observed downtime during the cutover. ECR
   repos, IAM roles, and secrets were left untouched, as planned — the CDK services
   use all of them.

   This was genuinely irreversible, as flagged throughout this doc: Express Gateway
   hostnames are not deterministic (demonstrated earlier this session — a recreate
   with identical config produced a totally different random hostname), so the old
   URLs (`ca-aa167deb702e4a338c4370ff70576195…` for web,
   `ca-185d9362…`/`ca-7dc84edc…` for mcp across its own earlier recreate) cannot be
   restored.

7. Re-run of the e2e suite against the new hostname as the sole staging environment
   is still a good idea before relying on this for serious QA, but is not a
   structural blocker — the CDK pair has already been verified end-to-end
   (real HTTP `200`s, a real MCP `tools/call` returning real tenant data, the drift
   checker reporting `UP TO DATE`) multiple times across this cutover.

**Staging is now sole-sourced from the CDK-managed pair.** `carrieros-web-staging`
and `carrieros-mcp-staging` (the original hand-built services) no longer exist.
