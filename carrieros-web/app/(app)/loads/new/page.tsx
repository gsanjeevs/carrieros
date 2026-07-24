// app/loads/new/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { intakeEmailForOrg } from '@/lib/domain/intake-email'
import CopyIntakeEmailButton from './CopyIntakeEmailButton'
import { Card } from '@/components/ui'

export default async function NewLoadPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .single()

  let intakeEmail: string | null = null
  if (profile?.org_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', profile.org_id)
      .maybeSingle()
    if (org?.name) intakeEmail = intakeEmailForOrg(profile.org_id, org.name)
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">

      <div className="mb-8">
        <Link href="/loads" className="text-text-sec text-sm hover:text-text-pri flex items-center gap-1.5 mb-4 rounded focus:outline-none focus:ring-2 focus:ring-brand-orange/50">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back to Loads
        </Link>
        <h1 className="text-2xl font-semibold text-text-pri">Add Load</h1>
        <p className="text-text-sec text-sm mt-1">How do you want to enter this load?</p>
      </div>

      <div className="grid gap-4">

        {/* Paste rate con */}
        <Link href="/loads/new/paste" className="block">
          <Card variant="interactive" className="group flex items-start gap-4 p-5 hover:border-brand-orange/40 hover:bg-brand-orange/5">
            <div className="w-10 h-10 rounded-lg bg-brand-orange/15 flex items-center justify-center flex-shrink-0 group-hover:bg-brand-orange/25 transition-colors">
              <span className="material-symbols-outlined text-brand-orange text-[20px]">content_paste</span>
            </div>
            <div className="flex-1">
              <p className="text-text-pri font-medium text-sm">Paste rate confirmation</p>
              <p className="text-text-sec text-sm mt-0.5">Copy text from an email or document — we&apos;ll extract the details automatically</p>
            </div>
            <span className="material-symbols-outlined text-text-mut group-hover:text-text-sec text-[20px] mt-0.5 transition-colors">chevron_right</span>
          </Card>
        </Link>

        {/* Upload PDF — not built yet. Was a live Link to a route that
            doesn't exist (/loads/new/upload), a 404 waiting to happen mid-demo.
            Disabled and labeled honestly instead of silently building a PDF
            extraction feature that hasn't been scoped. */}
        <Card aria-disabled="true" className="flex items-start gap-4 p-5 opacity-50 cursor-not-allowed">
          <div className="w-10 h-10 rounded-lg bg-teal/15 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-teal text-[20px]">upload_file</span>
          </div>
          <div className="flex-1">
            <p className="text-text-pri font-medium text-sm">Upload PDF</p>
            <p className="text-text-sec text-sm mt-0.5">Upload a rate con PDF — we&apos;ll read and extract the load details</p>
          </div>
          <span className="text-text-sec text-xs font-medium">Coming soon</span>
        </Card>

        {/* Manual entry */}
        <Link href="/loads/new/manual" className="block">
          <Card variant="interactive" className="group flex items-start gap-4 p-5 hover:border-brand-orange/40 hover:bg-brand-orange/5">
            <div className="w-10 h-10 rounded-lg bg-surface-subtle flex items-center justify-center flex-shrink-0 group-hover:bg-white/15 transition-colors">
              <span className="material-symbols-outlined text-text-sec text-[20px]">edit</span>
            </div>
            <div className="flex-1">
              <p className="text-text-pri font-medium text-sm">Enter manually</p>
              <p className="text-text-sec text-sm mt-0.5">Type in the load details yourself</p>
            </div>
            <span className="material-symbols-outlined text-text-mut group-hover:text-text-sec text-[20px] mt-0.5 transition-colors">chevron_right</span>
          </Card>
        </Link>

        {/* Forward by email — not a clickable tile (nothing happens in-app),
            just the address to give brokers or set up as a forwarding
            target. See lib/domain/intake-email.ts for why this is generated,
            not stored, and app/api/intake/email/route.ts for the webhook
            that consumes it. */}
        {intakeEmail && (
          <Card className="flex items-start gap-4 p-5">
            <div className="w-10 h-10 rounded-lg bg-sky-500/15 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-sky-400 text-[20px]">forward_to_inbox</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-text-pri font-medium text-sm">Forward by email</p>
              <p className="text-text-sec text-sm mt-0.5">Forward a rate confirmation to this address and it&apos;s extracted automatically</p>
              <div className="flex items-center gap-2 mt-2">
                <code className="text-text-sec text-xs bg-black/20 px-2 py-1 rounded truncate">{intakeEmail}</code>
                <CopyIntakeEmailButton email={intakeEmail} />
              </div>
            </div>
          </Card>
        )}

      </div>
    </div>
  )
}
