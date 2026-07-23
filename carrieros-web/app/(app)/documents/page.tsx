// app/(app)/documents/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { formatDateTime } from '@/lib/format-datetime'
import CompanyDocuments, { type CompanyDocType, type CompanyDocument } from '@/components/CompanyDocuments'

// RLS (owner_solo_org_docs_all / finance_org_docs_select): owner/solo have
// full read-write, finance is read-only, dispatchers and drivers have no
// access to org_documents at all — matches the PRD's company-compliance
// scope (COI, MC authority, DOT cert, UCR, W-9, business license).
const VIEW_ROLES = ['owner', 'solo', 'finance']

export default async function DocumentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, role, date_format, time_format')
    .eq('id', user.id)
    .single()
  if (!profile?.org_id) redirect('/onboarding')

  const t = await getTranslations('companyDocuments')

  if (!VIEW_ROLES.includes(profile.role)) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-white">{t('title')}</h1>
        <p className="text-slate-400 mt-2 text-sm">{t('noAccess')}</p>
      </div>
    )
  }

  const canManage = ['owner', 'solo'].includes(profile.role)

  const { data: docRows } = await supabase
    .from('org_documents')
    .select('id, doc_type, storage_path, expiry_date, created_at, profiles(first_name, last_name)')
    .eq('org_id', profile.org_id)
    .order('created_at', { ascending: false })

  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'heic', 'webp']
  const documents: CompanyDocument[] = await Promise.all(
    (docRows ?? []).map(async (d) => {
      const fileName = d.storage_path.split('/').pop() ?? d.storage_path
      const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrl(d.storage_path, 60 * 60)
      return {
        id: d.id,
        type: (d.doc_type ?? 'other') as CompanyDocType,
        storagePath: d.storage_path,
        fileName: fileName.replace(/^\d{10,}-/, ''),
        isImage: IMAGE_EXT.includes(ext),
        signedUrl: signed?.signedUrl ?? null,
        expiryDate: d.expiry_date,
        createdAtLabel: formatDateTime(d.created_at, profile),
        uploaderName: d.profiles
          ? [d.profiles.first_name, d.profiles.last_name].filter(Boolean).join(' ') || null
          : null,
      }
    })
  )

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">{t('title')}</h1>
        <p className="text-slate-400 text-sm mt-1">{t('pageDescription')}</p>
      </div>

      <CompanyDocuments
        documents={documents}
        orgId={profile.org_id}
        userId={user.id}
        canUpload={canManage}
        canDelete={canManage}
      />
    </div>
  )
}
