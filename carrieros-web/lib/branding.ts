// lib/branding.ts
// Single resolver for the AUTHENTICATED app's org branding (Enterprise
// branding customization, decisions.md PR1 amendment) — every authenticated
// surface that needs an org's logo/brand colors (app shell, the settings
// page's current-state read) calls this ONE function, never re-derives
// has_feature('branding_customization') or re-reads
// organizations.logo_path/carrier_details.brand_*_color ad hoc. Matches the
// pattern lib/entitlements.ts already uses: a thin wrapper around a
// SECURITY DEFINER RPC (get_org_branding(), migration 0026), which is where
// the actual entitlement decision lives — not here.
//
// The public tracking page (app/track/[token]/page.tsx) is the one
// deliberate exception, same shape as lib/domain/load-status.ts's own
// documented exception for that page: it has no auth session, so
// get_org_branding()'s my_org_id()-based lookup can't serve it, and it
// resolves branding via get_public_tracking()'s own extended columns
// instead. Both paths still funnel through lib/domain/branding.ts's
// brandingCssVars() for the actual CSS-variable mapping — see that file's
// header comment.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { createStorageProvider } from '@/lib/storage'

export interface OrgBranding {
  enabled: boolean
  logoUrl: string | null
  primaryColor: string | null
  accentColor: string | null
}

const SIGNED_URL_TTL_SECONDS = 60 * 60

const DISABLED: OrgBranding = { enabled: false, logoUrl: null, primaryColor: null, accentColor: null }

export async function getOrgBranding(supabase: SupabaseClient<Database>): Promise<OrgBranding> {
  const { data } = await supabase.rpc('get_org_branding')
  const row = data?.[0]
  if (!row || !row.enabled) return DISABLED

  let logoUrl: string | null = null
  if (row.logo_path) {
    const storage = createStorageProvider(supabase)
    logoUrl = await storage.getSignedUrl(row.logo_path, SIGNED_URL_TTL_SECONDS).catch(() => null)
  }

  return {
    enabled: true,
    logoUrl,
    primaryColor: row.primary_color,
    accentColor: row.accent_color,
  }
}
