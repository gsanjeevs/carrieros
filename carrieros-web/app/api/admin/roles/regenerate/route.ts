// app/api/admin/roles/regenerate/route.ts
// Runs scripts/gen-role-capabilities.mjs (repo root) so edits made on the
// Role Capabilities screen actually take effect. role_capabilities is not
// read live: proxy.ts's ROLE_ROUTES and every roleHasCapability() call
// across web + mobile read the COMMITTED generated file, not the table.
// This route only regenerates that file on disk in this environment — the
// UI must still tell the operator to review/commit/deploy it.
//
// Uses execFile (argv array, no shell) rather than exec/string
// interpolation — defense in depth even though no request input reaches
// the command.
import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'
import { logError } from '@/lib/observability'

const execFileAsync = promisify(execFile)

// carrieros-web -> repo root -> scripts/gen-role-capabilities.mjs
const REPO_ROOT = path.resolve(process.cwd(), '..')
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'gen-role-capabilities.mjs')
const GENERATED_FILES = [
  path.join(REPO_ROOT, 'carrieros-web', 'lib', 'generated', 'role-capabilities.ts'),
  path.join(REPO_ROOT, 'carrieros-mobile', 'src', 'lib', 'generated', 'role-capabilities.ts'),
]

export async function POST(request: NextRequest) {
  const ctx = await requireAdminRole(request, 'admin_flags')
  if (isErrorResponse(ctx)) return ctx

  // A deployed production environment's filesystem is read-only (or ephemeral, reset on the next
  // deploy) — this route writing lib/generated/role-capabilities.ts on disk there either fails
  // outright or silently does nothing useful: the already-running process's bundled code doesn't
  // reload it, and the edit is never committed to git, so it's gone on the next deploy regardless.
  // Regenerating only ever does something real in a local dev checkout, where the operator can
  // review, commit, and deploy the result themselves. Gated server-side (not just hidden in the UI)
  // since this is a real capability boundary, not a cosmetic one.
  if (process.env.NODE_ENV === 'production') {
    return apiError('NOT_AVAILABLE_IN_PRODUCTION', 'Regenerate only works in a local dev checkout; edit role_capabilities, then have an engineer run scripts/gen-role-capabilities.mjs, commit, and deploy.', 400)
  }

  const { readFileSync } = await import('node:fs')
  const before = GENERATED_FILES.map((f) => {
    try {
      // GENERATED_FILES is a fixed, module-scoped constant, not user input -- but Next's build
      // tracer can't prove that statically and otherwise traces (and bundles into the standalone
      // output) the ENTIRE monorepo, including tests/, scripts/, and carrieros-mobile/, which is
      // both a slow/bloated deploy artifact and the reason vitest picked up the intentionally-red
      // tests/audit/** suite a second time (as .next/standalone/tests/audit/**, outside the
      // exclude glob's reach) and failed CI on every commit since this route was added.
      return readFileSync(/*turbopackIgnore: true*/ f, 'utf8')
    } catch {
      return null
    }
  })

  try {
    await execFileAsync('node', [SCRIPT_PATH], { cwd: REPO_ROOT, timeout: 30_000 })
  } catch (err) {
    logError({ route: 'admin/roles/regenerate POST', requestId: request.headers.get('x-request-id') }, err)
    const message = err instanceof Error ? err.message : 'Regenerate script failed'
    return apiError('SERVER_ERROR', message, 500)
  }

  const after = GENERATED_FILES.map((f) => {
    try {
      return readFileSync(/*turbopackIgnore: true*/ f, 'utf8')
    } catch {
      return null
    }
  })

  const changedFiles = GENERATED_FILES.filter((_, i) => before[i] !== after[i]).map((f) => path.relative(REPO_ROOT, f))

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    changed: changedFiles.length > 0,
    changedFiles,
  })
}
