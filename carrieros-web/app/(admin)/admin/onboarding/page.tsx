'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, Card, CardBody, CardHeader, Input, StatusBadge } from '@/components/ui'

type Stage = 'intake' | 'setup' | 'training' | 'launch_ready' | 'live' | 'blocked'
interface OnboardingCase {
  org_id: number; company_name: string; tier: string; billing_status: string
  contact_name: string; contact_email: string; stage: Stage; next_action: string | null
  next_follow_up_at: string | null; blocker_note: string | null; owner_invite_sent_at: string | null; updated_at: string
}

export default function AdminOnboardingPage() {
  const t = useTranslations('admin.onboarding')
  const router = useRouter()
  const [cases, setCases] = useState<OnboardingCase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [tier, setTier] = useState('starter')
  const [country, setCountry] = useState('US')

  async function load() {
    try {
      const response = await fetch('/api/admin/onboarding')
      if (!response.ok) throw new Error()
      const result = await response.json() as { cases: OnboardingCase[] }
      setCases(result.cases)
      setError('')
    } catch { setError(t('error')) } finally { setLoading(false) }
  }
  useEffect(() => { void Promise.resolve().then(load) /* eslint-disable-line react-hooks/exhaustive-deps */ }, [])

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/admin/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_name: companyName, contact_name: contactName, contact_email: contactEmail, tier, country }) })
      if (!response.ok) throw new Error()
      const result = await response.json() as { org_id: number }
      router.push(`/admin/onboarding/${result.org_id}`)
    } catch { setError(t('createError')) } finally { setSaving(false) }
  }

  return (
    <div className="p-8 space-y-5">
      <header><h1 className="text-2xl font-semibold text-text-pri mb-1">{t('title')}</h1><p className="text-sm text-text-sec">{t('subtitle')}</p></header>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Card>
        <CardHeader><h2 className="text-sm font-medium text-text-pri">{t('startTitle')}</h2></CardHeader>
        <CardBody>
          <p className="text-xs text-text-mut mb-4">{t('startNote')}</p>
          <form onSubmit={createCase} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <Input required minLength={2} maxLength={160} value={companyName} onChange={event => setCompanyName(event.target.value)} placeholder={t('companyName')} aria-label={t('companyName')} />
            <Input required maxLength={120} value={contactName} onChange={event => setContactName(event.target.value)} placeholder={t('contactName')} aria-label={t('contactName')} />
            <Input required type="email" maxLength={254} value={contactEmail} onChange={event => setContactEmail(event.target.value)} placeholder={t('contactEmail')} aria-label={t('contactEmail')} />
            <Input as="select" value={tier} onChange={event => setTier(event.target.value)} aria-label={t('tier')}>
              {['starter', 'growth', 'pro', 'enterprise'].map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
            </Input>
            <Input as="select" value={country} onChange={event => setCountry(event.target.value)} aria-label={t('country')}>
              <option value="US">United States</option><option value="CA">Canada</option><option value="MX">Mexico</option>
            </Input>
            <Button type="submit" loading={saving}>{t('start')}</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-medium text-text-pri">{t('casesTitle', { count: cases.length })}</h2></CardHeader>
        {loading ? <CardBody><p className="text-sm text-text-mut">{t('loading')}</p></CardBody> : cases.length === 0 ? <CardBody><p className="text-sm text-text-mut">{t('empty')}</p></CardBody> : (
          <div className="divide-y divide-divider-ui">{cases.map(item => <Link href={`/admin/onboarding/${item.org_id}`} key={item.org_id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-surface-subtle">
            <div><p className="text-sm font-medium text-text-pri">{item.company_name}</p><p className="text-xs text-text-mut">{item.contact_name} · {item.contact_email} · {item.tier}</p>{item.next_action && <p className="text-xs text-text-sec mt-1">{item.next_action}</p>}</div>
            <div className="flex items-center gap-3"><span className="text-xs text-text-mut">{item.next_follow_up_at ? t('followUp', { date: new Date(item.next_follow_up_at).toLocaleDateString() }) : t('noFollowUp')}</span><StatusBadge size="sm" variant={item.stage === 'blocked' ? 'danger' : item.stage === 'live' ? 'success' : 'info'}>{t(`stage.${item.stage}`)}</StatusBadge></div>
          </Link>)}</div>
        )}
      </Card>
    </div>
  )
}
