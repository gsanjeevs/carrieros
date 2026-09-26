// app/(app)/messages/page.tsx
// Dispatcher/owner-facing aggregate message inbox — every load's message
// thread, newest activity first, with unread counts. Never built before
// (legacy or v1); every prior messages capability (DriverMessageThread) is
// scoped to one load's thread. Reuses the same createConversationService(...)
// the /api/v1/messages route uses (mobile/web client code) — server data
// access stays in-process per ADR 0003 rather than calling that route.
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability } from '@/lib/generated/role-capabilities'
import { createConversationService } from '@/server/composition'
import { buildActorContext } from '@/server/infrastructure/supabase/actor-context'
import MessageInbox from '@/components/MessageInbox'

export default async function MessagesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await getProfileForUser(supabase, user.id)
  if (!profile?.org_id) redirect('/onboarding')

  const t = await getTranslations('messages')

  if (!roleHasCapability(profile.role, 'loads_manage')) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
        <p className="text-text-sec mt-2 text-sm">{t('noAccess')}</p>
      </div>
    )
  }

  const actor = await buildActorContext(supabase, user, crypto.randomUUID())
  if (!actor.ok) redirect('/onboarding')

  const result = await createConversationService(supabase).list(actor.value)
  const conversations = result.ok ? result.value : []

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text-pri">{t('title')}</h1>
        <p className="text-text-sec text-sm mt-1">{t('pageDescription')}</p>
      </div>

      <MessageInbox conversations={conversations} dateTimePrefs={profile} />
    </div>
  )
}
