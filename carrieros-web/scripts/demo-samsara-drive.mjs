#!/usr/bin/env node
// carrieros-web/scripts/demo-samsara-drive.mjs
//
// Repeatedly calls POST /api/cron/telematics/samsara-poll (the same route a
// real external scheduler would call in production) every few seconds, so
// the two trucks scripts/demo-samsara-setup.mjs registered visibly move on
// the live dispatch map (/dispatch) for as long as this keeps running.
// Ctrl+C to stop -- this has no persistent state, it's just a loop.
//
// Requires: scripts/demo-samsara-setup.mjs already run, SAMSARA_API_BASE_URL
// pointed at the mock feed in .env.local, and the dev server restarted
// after that env var was set.
//
// Usage: APP_URL=http://localhost:3001 node scripts/demo-samsara-drive.mjs
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadDotEnvLocal() {
  const envPath = join(__dirname, '..', '.env.local')
  if (!existsSync(envPath)) return {}
  const out = {}
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const dotenv = loadDotEnvLocal()
const APP_URL = process.env.APP_URL || 'http://localhost:3001'
const CRON_SECRET = process.env.CRON_SECRET || dotenv.CRON_SECRET
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 4000)

if (!CRON_SECRET) {
  console.error('Set CRON_SECRET (or populate it in .env.local) -- same shared secret app/api/cron/telematics/samsara-poll checks.')
  process.exit(1)
}
if (!dotenv.SAMSARA_API_BASE_URL && !process.env.SAMSARA_API_BASE_URL) {
  console.error(
    'SAMSARA_API_BASE_URL is not set in .env.local -- the poller would call the real ' +
    'api.samsara.com (and fail, since no real account/key exists) instead of the local mock. ' +
    'Run scripts/demo-samsara-setup.mjs first and follow its printed instructions.'
  )
  process.exit(1)
}

console.log(`Polling ${APP_URL}/api/cron/telematics/samsara-poll every ${POLL_INTERVAL_MS}ms. Ctrl+C to stop.`)
console.log('Open /dispatch in another tab to watch the trucks move.\n')

async function pollOnce() {
  const res = await fetch(`${APP_URL}/api/cron/telematics/samsara-poll`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  })
  const body = await res.json().catch(() => ({}))
  const stamp = new Date().toLocaleTimeString()
  if (!res.ok) {
    console.log(`[${stamp}] poll failed: HTTP ${res.status} ${JSON.stringify(body)}`)
    return
  }
  console.log(`[${stamp}] orgs_polled=${body.orgs_polled} locations_written=${body.locations_written} orgs_failed=${body.orgs_failed}`)
}

let stopped = false
process.on('SIGINT', () => {
  stopped = true
  console.log('\nStopping.')
  process.exit(0)
})

while (!stopped) {
  await pollOnce().catch((e) => console.log('poll error:', e.message))
  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
}
