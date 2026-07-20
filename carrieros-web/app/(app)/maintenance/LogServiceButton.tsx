'use client'
// app/(app)/maintenance/LogServiceButton.tsx
// Logs a completed service directly against service_logs and (optionally)
// the matching maintenance_reminders row — plain RLS-protected CRUD with no
// server secret involved, so this calls Supabase directly from the browser
// client rather than going through a Next.js API route (decision R3b).
// Only rendered for owner/solo (see page.tsx RLS note — dispatcher can read
// but not write these two tables).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { toDate } from '@/lib/format-datetime'

type Truck = {
  id: number
  truck_number: string | null
  nickname: string | null
}

type Reminder = {
  id: number
  truck_id: number
  reminder_type: string
  trigger_miles: number | null
  trigger_months: number | null
}

const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-[#f97316] transition'
const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5'

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// service_date + N months, returned as 'YYYY-MM-DD'. Postgres DATE columns
// are date-only, so this stays in local-date arithmetic (see toDate's
// comment in lib/format-datetime.ts on why date-only values must not be
// parsed as UTC).
function addMonths(dateStr: string, months: number): string {
  const d = toDate(dateStr)
  d.setMonth(d.getMonth() + months)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const NEW_REMINDER = '__new__'
const NO_REMINDER = ''

export default function LogServiceButton({ trucks, reminders }: { trucks: Truck[]; reminders: Reminder[] }) {
  const router = useRouter()
  const t = useTranslations('maintenance')
  const tCommon = useTranslations('common')

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const emptyForm = {
    truck_id: trucks[0]?.id ? String(trucks[0].id) : '',
    reminder_id: NO_REMINDER as string,
    new_reminder_type: '',
    new_trigger_miles: '',
    new_trigger_months: '',
    service_type: '',
    service_date: todayISO(),
    odometer: '',
    cost: '',
    shop_name: '',
    notes: '',
  }
  const [form, setForm] = useState(emptyForm)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  function close() {
    if (loading) return
    setOpen(false)
    setError('')
    setForm(emptyForm)
  }

  const truckReminders = reminders.filter(r => String(r.truck_id) === form.truck_id)
  const selectedReminder = truckReminders.find(r => String(r.id) === form.reminder_id)

  async function submit() {
    setLoading(true)
    setError('')
    const supabase = createClient()

    try {
      const truckId = Number(form.truck_id)
      if (!truckId) throw new Error(t('selectTruckRequired'))

      const serviceType = form.reminder_id === NEW_REMINDER
        ? form.new_reminder_type.trim()
        : (selectedReminder?.reminder_type ?? form.service_type.trim())

      if (!serviceType) throw new Error(t('serviceTypeRequired'))

      const odometer = form.odometer ? Number(form.odometer) : null
      const cost = form.cost ? Number(form.cost) : null

      const { data: { user } } = await supabase.auth.getUser()

      const { data: profile } = await supabase
        .from('profiles')
        .select('org_id')
        .eq('id', user?.id ?? '')
        .single()

      if (!profile?.org_id) throw new Error(tCommon('somethingWentWrong'))

      const { error: insertError } = await supabase
        .from('service_logs')
        .insert({
          truck_id: truckId,
          carrier_org_id: profile.org_id,
          service_type: serviceType,
          service_date: form.service_date,
          odometer,
          cost,
          shop_name: form.shop_name.trim() || null,
          notes: form.notes.trim() || null,
          logged_by: user?.id ?? null,
        })

      if (insertError) throw new Error(insertError.message)

      // Update or create the linked reminder so "log a service" also
      // reschedules the next one.
      if (form.reminder_id === NEW_REMINDER) {
        const triggerMiles = form.new_trigger_miles ? Number(form.new_trigger_miles) : null
        const triggerMonths = form.new_trigger_months ? Number(form.new_trigger_months) : null
        const { error: reminderError } = await supabase
          .from('maintenance_reminders')
          .insert({
            truck_id: truckId,
            carrier_org_id: profile.org_id,
            reminder_type: serviceType,
            trigger_miles: triggerMiles,
            trigger_months: triggerMonths,
            last_service_date: form.service_date,
            last_odometer: odometer,
            next_due_date: triggerMonths ? addMonths(form.service_date, triggerMonths) : null,
            next_due_miles: (triggerMiles && odometer) ? odometer + triggerMiles : null,
          })
        if (reminderError) throw new Error(reminderError.message)
      } else if (selectedReminder) {
        const nextDueDate = selectedReminder.trigger_months
          ? addMonths(form.service_date, selectedReminder.trigger_months)
          : null
        const nextDueMiles = (selectedReminder.trigger_miles && odometer)
          ? odometer + selectedReminder.trigger_miles
          : null
        const { error: reminderError } = await supabase
          .from('maintenance_reminders')
          .update({
            last_service_date: form.service_date,
            last_odometer: odometer,
            next_due_date: nextDueDate,
            next_due_miles: nextDueMiles,
          })
          .eq('id', selectedReminder.id)
        if (reminderError) throw new Error(reminderError.message)
      }

      const truck = trucks.find(tr => tr.id === truckId)
      setOpen(false)
      setForm(emptyForm)
      router.push(`/maintenance?logged=${encodeURIComponent(truck?.truck_number ?? '')}`)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-[#f97316]/50"
      >
        <span className="material-symbols-outlined text-[18px]">add</span>
        {t('logService')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-md bg-[#0f1923] border border-white/10 rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-lg">{t('logService')}</h2>
              <button onClick={close} className="text-slate-500 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-[#f97316]/50 rounded">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className={labelCls}>{t('truck')} *</label>
                <select className={inputCls} value={form.truck_id}
                  onChange={e => setForm(f => ({ ...f, truck_id: e.target.value, reminder_id: NO_REMINDER }))}>
                  {trucks.map(truck => (
                    <option key={truck.id} value={truck.id}>
                      {truck.truck_number}{truck.nickname ? ` — ${truck.nickname}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>{t('whichReminder')}</label>
                <select className={inputCls} value={form.reminder_id} onChange={e => set('reminder_id', e.target.value)}>
                  <option value={NO_REMINDER}>{t('generalServiceNoReminder')}</option>
                  {truckReminders.map(r => (
                    <option key={r.id} value={r.id}>{r.reminder_type}</option>
                  ))}
                  <option value={NEW_REMINDER}>{t('createNewReminder')}</option>
                </select>
              </div>

              {form.reminder_id === NEW_REMINDER && (
                <div className="space-y-3 pl-3 border-l-2 border-white/10">
                  <div>
                    <label className={labelCls}>{t('reminderType')} *</label>
                    <input className={inputCls} placeholder={t('reminderTypeExample')}
                      value={form.new_reminder_type} onChange={e => set('new_reminder_type', e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>{t('triggerMiles')}</label>
                      <input className={inputCls} inputMode="numeric" placeholder="10000"
                        value={form.new_trigger_miles} onChange={e => set('new_trigger_miles', e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>{t('triggerMonths')}</label>
                      <input className={inputCls} inputMode="numeric" placeholder="6"
                        value={form.new_trigger_months} onChange={e => set('new_trigger_months', e.target.value)} />
                    </div>
                  </div>
                </div>
              )}

              {form.reminder_id === NO_REMINDER && (
                <div>
                  <label className={labelCls}>{t('serviceType')} *</label>
                  <input className={inputCls} placeholder={t('serviceTypePlaceholder')}
                    value={form.service_type} onChange={e => set('service_type', e.target.value)} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('serviceDate')} *</label>
                  <input className={inputCls} type="date"
                    value={form.service_date} onChange={e => set('service_date', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t('odometer')}</label>
                  <input className={inputCls} inputMode="numeric" placeholder="142450"
                    value={form.odometer} onChange={e => set('odometer', e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('cost')}</label>
                  <input className={inputCls} inputMode="decimal" placeholder="189.99"
                    value={form.cost} onChange={e => set('cost', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t('shop')}</label>
                  <input className={inputCls} placeholder="Joe's Truck Repair"
                    value={form.shop_name} onChange={e => set('shop_name', e.target.value)} />
                </div>
              </div>

              <div>
                <label className={labelCls}>{t('notes')}</label>
                <textarea className={inputCls + ' resize-none'} rows={2}
                  value={form.notes} onChange={e => set('notes', e.target.value)} />
              </div>

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-3 mt-2">
                <button
                  onClick={close}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white font-medium rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-[#f97316]/50"
                >
                  {tCommon('cancel')}
                </button>
                <button
                  onClick={submit}
                  disabled={loading || !form.truck_id}
                  className="flex-2 flex-grow py-2.5 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-[#f97316]/50"
                >
                  {loading ? t('logging') : t('logService')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
