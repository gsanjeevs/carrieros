// app/(app)/layout.tsx
// Shared layout for all authenticated pages — provides dark shell + sidebar
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/Sidebar'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, first_name, last_name')
    .eq('id', user.id)
    .single()

  const role = profile?.role ?? 'solo'
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user.email || 'User'

  return (
    <div className="flex h-screen bg-[#0f1923] overflow-hidden">
      <Sidebar role={role} userName={name} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
