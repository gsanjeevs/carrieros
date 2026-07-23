// lib/domain/intake-email.ts
// Per-carrier dedicated inbound load-intake address (PRD P0: "Dedicated
// inbound email address provisioned at signup"). Deliberately NOT a
// persisted column — it's a pure function of org id + name, so there's
// nothing to backfill/migrate and nothing that can drift out of sync with
// the org row (Rule B: don't add state for something derivable).
//
// The domain (intake.carrieros.dev) is not a real, provider-registered
// inbound-parse domain in this project — same demo-mode-seam framing as
// the ACH/SMS stubs elsewhere: the address format, parsing, and the
// webhook that consumes it (app/api/intake/email/route.ts) are all real
// and complete. Only the actual DNS MX/inbound-parse registration with a
// provider (Mailgun Routes, Postmark Inbound, SendGrid Inbound Parse) is
// out of scope for local dev.
const INTAKE_DOMAIN = 'intake.carrieros.dev'

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'carrier'
}

export function intakeEmailForOrg(orgId: number, orgName: string): string {
  return `${slugify(orgName)}-${orgId}@${INTAKE_DOMAIN}`
}

// Recovers the org id from an inbound `to` address's local part
// (`{slug}-{orgId}@...`) — the numeric suffix is the only part that must
// round-trip; the slug is cosmetic (a friendlier address than a bare id)
// and isn't re-validated against the org's current name, since a carrier
// renaming their company shouldn't break mail already forwarded/bookmarked
// to the old-slug address.
export function orgIdFromIntakeEmail(address: string): number | null {
  const match = address.trim().toLowerCase().match(/-(\d+)@[^@]+$/)
  if (!match) return null
  const orgId = Number(match[1])
  return Number.isInteger(orgId) ? orgId : null
}
