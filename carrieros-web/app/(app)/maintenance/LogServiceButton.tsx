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
import { Button, Input, Modal } from '@/components/ui'

type Vehicle = {
  id: number
  vehicle_number: string | null
  nickname: string | null
}

type Reminder = {
  id: number
  vehicle_id: number
  reminder_type: string
  trigger_miles: number | null
  trigger_months: number | null
}

const labelCls = 'block text-xs font-medium text-text-sec mb-1.5'

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

export default function LogServiceButton({ vehicles, reminders }: { vehicles: Vehicle[]; reminders: Reminder[] }) {
  const router = useRouter()
  const t = useTranslations('maintenance')
  const tCommon = useTranslations('common')

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const emptyForm = {
    vehicle_id: vehicles[0]?.id ? String(vehicles[0].id) : '',
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

  const vehicleReminders = reminders.filter(r => String(r.vehicle_id) === form.vehicle_id)
  const selectedReminder = vehicleReminders.find(r => String(r.id) === form.reminder_id)

  async function submit() {
    setLoading(true)
    setError('')
    const supabase = createClient()

    try {
      const vehicleId = Number(form.vehicle_id)
      if (!vehicleId) throw new Error(t('selectTruckRequired'))

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
          vehicle_id: vehicleId,
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
            vehicle_id: vehicleId,
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

      const vehicle = vehicles.find(v => v.id === vehicleId)
      setOpen(false)
      setForm(emptyForm)
      router.push(`/maintenance?logged=${encodeURIComponent(vehicle?.vehicle_number ?? '')}`)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <span className="material-symbols-outlined text-[18px]">add</span>
        {t('logService')}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={t('logService')}
        className="max-h-[90vh] overflow-y-auto"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={close} disabled={loading}>
              {tCommon('cancel')}
            </Button>
            <Button size="sm" onClick={submit} disabled={loading || !form.vehicle_id} loading={loading}>
              {loading ? t('logging') : t('logService')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>{t('truck')} *</label>
            <Input as="select" value={form.vehicle_id}
              onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value, reminder_id: NO_REMINDER }))}>
              {vehicles.map(vehicle => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.vehicle_number}{vehicle.nickname ? ` — ${vehicle.nickname}` : ''}
                </option>
              ))}
            </Input>
          </div>

          <div>
            <label className={labelCls}>{t('whichReminder')}</label>
            <Input as="select" value={form.reminder_id} onChange={e => set('reminder_id', e.target.value)}>
              <option value={NO_REMINDER}>{t('generalServiceNoReminder')}</option>
              {vehicleReminders.map(r => (
                <option key={r.id} value={r.id}>{r.reminder_type}</option>
              ))}
              <option value={NEW_REMINDER}>{t('createNewReminder')}</option>
            </Input>
          </div>

          {form.reminder_id === NEW_REMINDER && (
            <div className="space-y-3 pl-3 border-l-2 border-border-ui">
              <div>
                <label className={labelCls}>{t('reminderType')} *</label>
                <Input placeholder={t('reminderTypeExample')}
                  value={form.new_reminder_type} onChange={e => set('new_reminder_type', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('triggerMiles')}</label>
                  <Input inputMode="numeric" placeholder="10000"
                    value={form.new_trigger_miles} onChange={e => set('new_trigger_miles', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t('triggerMonths')}</label>
                  <Input inputMode="numeric" placeholder="6"
                    value={form.new_trigger_months} onChange={e => set('new_trigger_months', e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {form.reminder_id === NO_REMINDER && (
            <div>
              <label className={labelCls}>{t('serviceType')} *</label>
              <Input placeholder={t('serviceTypePlaceholder')}
                value={form.service_type} onChange={e => set('service_type', e.target.value)} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('serviceDate')} *</label>
              <Input type="date"
                value={form.service_date} onChange={e => set('service_date', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('odometer')}</label>
              <Input inputMode="numeric" placeholder="142450"
                value={form.odometer} onChange={e => set('odometer', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('cost')}</label>
              <Input inputMode="decimal" placeholder="189.99"
                value={form.cost} onChange={e => set('cost', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t('shop')}</label>
              <Input placeholder="Joe's Vehicle Repair"
                value={form.shop_name} onChange={e => set('shop_name', e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelCls}>{t('notes')}</label>
            <Input as="textarea" className="resize-none" rows={2}
              value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>

          {error && (
            <div className="rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">
              {error}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
