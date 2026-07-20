'use client'
// app/(app)/customers/AddCustomerButton.tsx
// Opens a modal form that calls POST /api/customers (delegates to the
// create_customer_org RPC — see app/api/customers/route.ts), then refreshes
// the customer list with a success banner (?created=<name>).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]

const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-[#f97316] transition'
const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5'

export default function AddCustomerButton({ variant }: { variant?: 'empty' }) {
  const router = useRouter()
  const t = useTranslations('customers')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')

  // `errors` messages are keyed by error_code — never render a raw API string.
  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const emptyForm = {
    name: '',
    contact_name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zip: '',
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

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          contact_name: form.contact_name.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          address: form.address.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state || undefined,
          zip: form.zip.trim() || undefined,
          notes: form.notes.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))

      setOpen(false)
      setForm(emptyForm)
      router.push(`/customers?created=${encodeURIComponent(json.name)}`)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tCommon('somethingWentWrong'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {variant === 'empty' ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-medium rounded-lg transition focus:outline-none focus:ring-2 focus:ring-[#f97316]/50"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          {t('addFirstCustomer')}
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-[#f97316]/50"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          {t('addCustomer')}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-md bg-[#0f1923] border border-white/10 rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-lg">{t('addCustomer')}</h2>
              <button onClick={close} className="text-slate-500 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-[#f97316]/50 rounded">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className={labelCls}>{t('companyName')} *</label>
                <input
                  className={inputCls}
                  placeholder="Fast Freight LLC"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                />
              </div>

              <div>
                <label className={labelCls}>{t('contactName')}</label>
                <input className={inputCls} placeholder="Mike Paulson"
                  value={form.contact_name} onChange={e => set('contact_name', e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('phone')}</label>
                  <input className={inputCls} placeholder="(555) 123-4567"
                    value={form.phone} onChange={e => set('phone', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t('email')}</label>
                  <input className={inputCls} type="email" placeholder="dispatch@example.com"
                    value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
              </div>

              <div>
                <label className={labelCls}>{t('address')}</label>
                <input className={inputCls} placeholder="123 Main St"
                  value={form.address} onChange={e => set('address', e.target.value)} />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>{t('city')}</label>
                  <input className={inputCls} placeholder="Chicago"
                    value={form.city} onChange={e => set('city', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>{t('state')}</label>
                  <select className={inputCls} value={form.state} onChange={e => set('state', e.target.value)}>
                    <option value="">{tCommon('selectPlaceholder')}</option>
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t('zip')}</label>
                  <input className={inputCls} placeholder="60601"
                    value={form.zip} onChange={e => set('zip', e.target.value)} />
                </div>
              </div>

              <div>
                <label className={labelCls}>{t('notes')}</label>
                <textarea className={inputCls + ' resize-none'} rows={2} placeholder={t('notesPlaceholder')}
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
                  disabled={loading || !form.name.trim()}
                  className="flex-2 flex-grow py-2.5 bg-[#f97316] hover:bg-[#ea6c0a] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition text-sm focus:outline-none focus:ring-2 focus:ring-[#f97316]/50"
                >
                  {loading ? t('adding') : t('addCustomer')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
