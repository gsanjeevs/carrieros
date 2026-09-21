// app/api/settings/branding/route.ts
//
// POST /api/settings/branding — set the org's Enterprise branding: logo
// (uploaded to Supabase Storage) and/or a small set of brand-color
// overrides (decisions.md PR1 amendment). Owner/solo only, same
// org-administration shape as team/vehicles/drivers management
// (roleHasCapability, migration 0023's pattern) — reused here via the new
// 'org_branding_manage' capability (migration 0026) rather than inventing a
// second gating mechanism.
//
// Gated Enterprise via has_feature('branding_customization') — same
// hasFeature() RPC wrapper every other tier-gated route already uses (see
// app/api/team/invite/route.ts, app/api/settlements/[id]/send-ach/route.ts).
//
// Logo reuses organizations.logo_path (decisions.md S10) — the SAME column
// onboarding's AddLogoStep.tsx already writes for every tier (invoices,
// customer directory). This route does not create a second logo field; it
// only gates the act of setting it here (and applying it to the app shell +
// public tracking page) to Enterprise. Colors live on carrier_details,
// server-write-only since migration 0019 (carrier_details is read-only to
// clients), so both writes go through the admin client after this route's
// own auth/role/entitlement checks — same pattern as
// app/api/billing/change-tier/route.ts.
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError, createAdminClient } from '@/lib/api-auth'
import { hasFeature } from '@/lib/entitlements'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability } from '@/lib/generated/role-capabilities'
import { createStorageProvider } from '@/lib/storage'
import { isValidBrandColor } from '@/lib/domain/branding'
import { logError, logEvent } from '@/lib/observability'

const ACCEPTED_LOGO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_LOGO_BYTES = 5 * 1024 * 1024

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
}

// A submitted color field is one of three states: absent (field not sent —
// leave the existing value untouched), '' (clear the override, fall back to
// the default theme color — same NULL-means-default semantics the
// migration 0026 column comment documents), or a real #RRGGBB value.
type ColorField = { state: 'absent' } | { state: 'clear' } | { state: 'set'; value: string }

function parseColorField(raw: FormDataEntryValue | null): ColorField | null {
  if (raw === null) return { state: 'absent' }
  if (typeof raw !== 'string') return null // invalid — e.g. a File where a string was expected
  const trimmed = raw.trim()
  if (trimmed === '') return { state: 'clear' }
  if (!isValidBrandColor(trimmed)) return null
  return { state: 'set', value: trimmed }
}

export async function POST(request: NextRequest) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx

  const { data: profile } = await getProfileForUser(supabase, user.id)
  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization found for this user', 400)
  if (!roleHasCapability(profile.role, 'org_branding_manage'))
    return apiError('FORBIDDEN', 'Only owner/solo can change branding', 403)

  const entitled = await hasFeature(supabase, 'branding_customization')
  if (!entitled) {
    return apiError(
      'TIER_UPGRADE_REQUIRED',
      'Branding customization requires the Enterprise plan',
      403
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return apiError('VALIDATION_ERROR', 'Expected multipart/form-data', 400)
  }

  const primary = parseColorField(form.get('primary_color'))
  const accent = parseColorField(form.get('accent_color'))
  if (!primary || !accent) {
    return apiError('VALIDATION_ERROR', 'Colors must be a #RRGGBB hex value or blank', 400)
  }

  const logoFile = form.get('logo')
  const hasLogo = logoFile instanceof File && logoFile.size > 0
  if (hasLogo) {
    const file = logoFile as File
    if (!ACCEPTED_LOGO_TYPES.has(file.type)) {
      return apiError('VALIDATION_ERROR', 'Logo must be a JPEG, PNG, or WebP image', 400)
    }
    if (file.size > MAX_LOGO_BYTES) {
      return apiError('VALIDATION_ERROR', 'Logo must be 5MB or smaller', 400)
    }
  }

  const colorUpdate: { brand_primary_color?: string | null; brand_accent_color?: string | null } = {}
  if (primary.state !== 'absent') colorUpdate.brand_primary_color = primary.state === 'set' ? primary.value : null
  if (accent.state !== 'absent') colorUpdate.brand_accent_color = accent.state === 'set' ? accent.value : null

  if (!hasLogo && Object.keys(colorUpdate).length === 0) {
    return apiError('VALIDATION_ERROR', 'Nothing to update — provide a logo and/or a color', 400)
  }

  const admin = createAdminClient()
  let logoPath: string | null | undefined

  if (hasLogo) {
    const file = logoFile as File
    const storage = createStorageProvider(admin)
    const path = `${profile.org_id}/logo/logo-${Date.now()}-${sanitize(file.name)}`
    try {
      await storage.uploadFile(path, file, file.type)
    } catch (err) {
      logError({ route: 'api/settings/branding', userId: user.id, orgId: profile.org_id }, err)
      return apiError('SERVER_ERROR', 'Failed to upload logo', 500)
    }

    const { error: orgErr } = await admin.from('organizations').update({ logo_path: path }).eq('id', profile.org_id)
    if (orgErr) {
      await storage.remove([path]).catch(() => {})
      logError({ route: 'api/settings/branding', userId: user.id, orgId: profile.org_id }, orgErr)
      return apiError('SERVER_ERROR', orgErr.message, 500)
    }
    logoPath = path
  }

  if (Object.keys(colorUpdate).length > 0) {
    const { error: cdErr } = await admin.from('carrier_details').update(colorUpdate).eq('org_id', profile.org_id)
    if (cdErr) {
      logError({ route: 'api/settings/branding', userId: user.id, orgId: profile.org_id }, cdErr)
      return apiError('SERVER_ERROR', cdErr.message, 500)
    }
  }

  logEvent({ route: 'api/settings/branding', userId: user.id, orgId: profile.org_id }, {
    updated_logo: hasLogo,
    updated_primary_color: primary.state !== 'absent',
    updated_accent_color: accent.state !== 'absent',
  })

  return NextResponse.json({
    logo_updated: hasLogo,
    logo_path: logoPath ?? null,
    primary_color: primary.state === 'set' ? primary.value : primary.state === 'clear' ? null : undefined,
    accent_color: accent.state === 'set' ? accent.value : accent.state === 'clear' ? null : undefined,
  })
}
