// app/api/version/route.ts
// Public, unauthenticated, read-only: reports which commit the running container was built from
// (Dockerfile's BUILD_SHA build arg, plain env var -- never a NEXT_PUBLIC_ var, so this is never
// baked into client-side JS, only read here at request time). Exists so "is staging actually running
// the latest commit on main" is a single HTTP call instead of manually reasoning through git log and
// deploy history -- the exact gap that let several 2026-09-27 fixes sit unpushed to staging for hours
// without anyone noticing, since GitHub Actions' Deploy job only ever applies DB migrations
// (architecture/deployment.md) and never actually rebuilds/redeploys the container.
//
// No secrets or internal detail here -- just a commit SHA and a build timestamp, safe to expose
// publicly (same posture as most SaaS /version or /healthz endpoints).
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    sha: process.env.BUILD_SHA ?? null,
    builtAt: process.env.BUILD_TIME ?? null,
  })
}
