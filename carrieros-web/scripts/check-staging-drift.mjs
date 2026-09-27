#!/usr/bin/env node
// carrieros-web/scripts/check-staging-drift.mjs
//
// Compares the commit `origin/main` is at against what staging's /api/version reports it's actually
// running, and exits non-zero (with a clear message) if they differ. Staging has no auto-deploy
// (architecture/deployment.md — GitHub Actions' Deploy job only ever applies DB migrations, never
// rebuilds/redeploys the container), so "pushed to main" and "live on staging" can silently diverge
// for hours or days with nothing surfacing it. This script is the cheap, no-AWS-credentials-needed
// way to catch that -- run it manually, or on a schedule (OpenClaw automation, cron, etc.) with
// STAGING_URL set, rather than relying on someone remembering to check.
//
// Requires the running container to have been built with BUILD_SHA set (see Dockerfile, and the
// updated manual deploy commands in architecture/deployment.md) -- an older image predating that
// change reports { sha: null }, which this script treats as "unknown, can't compare" rather than a
// false "drift" alarm.
//
// Usage:
//   node scripts/check-staging-drift.mjs
//   STAGING_URL=https://your-other-env node scripts/check-staging-drift.mjs
import { execSync } from 'node:child_process'

const STAGING_URL = process.env.STAGING_URL || 'https://ca-aa167deb702e4a338c4370ff70576195.ecs.us-east-1.on.aws'

function git(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim()
}

async function main() {
  git('git fetch origin main --quiet')
  const mainSha = git('git rev-parse origin/main')

  const res = await fetch(`${STAGING_URL}/api/version`)
  if (!res.ok) {
    console.error(`FAILED: ${STAGING_URL}/api/version returned HTTP ${res.status}`)
    process.exit(1)
  }
  const { sha: stagingSha, builtAt } = await res.json()

  if (!stagingSha) {
    console.log('UNKNOWN: staging is running an image built before BUILD_SHA was added -- redeploy once to start tracking this.')
    process.exit(0)
  }

  if (stagingSha === mainSha) {
    console.log(`UP TO DATE: staging is running origin/main's HEAD (${mainSha.slice(0, 12)}), built ${builtAt ?? 'unknown time'}.`)
    process.exit(0)
  }

  const behindBy = (() => {
    try {
      return git(`git rev-list --count ${stagingSha}..${mainSha}`)
    } catch {
      return 'unknown number of'
    }
  })()

  console.error(
    `DRIFT: staging is running ${stagingSha.slice(0, 12)} (built ${builtAt ?? 'unknown time'}), ` +
    `but origin/main is at ${mainSha.slice(0, 12)} -- staging is ${behindBy} commit(s) behind. ` +
    `Redeploy per architecture/deployment.md's manual deploy steps.`
  )
  process.exit(1)
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
