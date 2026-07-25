'use client'
// components/CustomerContacts.tsx
// Contacts tab on the customer detail page (Phase 3H). A customer org can
// have many contacts; some may be granted portal login via the invite route
// below, which mirrors app/api/team/invite's admin-client magic-link
// pattern. Revoking access deactivates the linked profile (never deletes)
// per the 2026-07-21 deactivate-not-delete directive — see
// app/api/customers/[org_id]/contacts/[contact_id]/revoke/route.ts.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Card, CardBody, Field, Input, Button, EmptyState, Table, TableHeaderCell, TableRow, TableCell } from '@/components/ui'

type Contact = {
  id: number
  name: string
  email: string | null
  phone: string | null
  title: string | null
  is_primary: boolean
  portal_profile_id: string | null
}

export default function CustomerContacts({
  orgId,
  canManage,
  initialContacts,
}: {
  orgId: number
  canManage: boolean
  initialContacts: Contact[]
}) {
  const router = useRouter()
  const t = useTranslations('customers')
  const tErrors = useTranslations('errors')

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  const [contacts, setContacts] = useState(initialContacts)
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', email: '', phone: '', title: '' })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function addContact() {
    setAdding(true)
    setError('')
    try {
      const res = await fetch(`/api/customers/${orgId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          title: form.title.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))
      setContacts(c => [...c, json])
      setForm({ name: '', email: '', phone: '', title: '' })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : friendly('SERVER_ERROR'))
    } finally {
      setAdding(false)
    }
  }

  async function invite(contactId: number) {
    setBusyId(contactId)
    setError('')
    try {
      const res = await fetch(`/api/customers/${orgId}/contacts/${contactId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'customer_viewer' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))
      // Update local state directly rather than relying on router.refresh()
      // alone — useState's initialContacts only seeds the FIRST render, it
      // doesn't re-sync when the parent server component gets fresh props,
      // so a refresh-only approach left this row showing stale "Not linked"
      // even though the invite had actually succeeded (found via live test).
      setContacts(c => c.map(ct => ct.id === contactId ? { ...ct, portal_profile_id: json.id } : ct))
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : friendly('SERVER_ERROR'))
    } finally {
      setBusyId(null)
    }
  }

  async function revoke(contactId: number) {
    if (!window.confirm(t('contactsRevokeConfirm'))) return
    setBusyId(contactId)
    setError('')
    try {
      const res = await fetch(`/api/customers/${orgId}/contacts/${contactId}/revoke`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(friendly(json.error_code))
      setContacts(c => c.map(ct => ct.id === contactId ? { ...ct, portal_profile_id: null } : ct))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : friendly('SERVER_ERROR'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      {contacts.length === 0 ? (
        <Card>
          <EmptyState icon="contacts" title={t('contactsEmpty')} />
        </Card>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>{t('contactsName')}</TableHeaderCell>
                <TableHeaderCell>{t('contactsTitle')}</TableHeaderCell>
                <TableHeaderCell>{t('contactsEmailPhone')}</TableHeaderCell>
                <TableHeaderCell>{t('contactsPortal')}</TableHeaderCell>
                {canManage && <TableHeaderCell />}
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.name}
                    {c.is_primary && (
                      <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-brand-orange/15 text-brand-orange">
                        {t('contactsPrimary')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-text-sec">{c.title ?? '—'}</TableCell>
                  <TableCell className="text-text-sec">{[c.email, c.phone].filter(Boolean).join(' · ') || '—'}</TableCell>
                  <TableCell>
                    {c.portal_profile_id ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-success/20 text-success">
                        {t('contactsLinked')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-500/20 text-slate-400">
                        {t('contactsNotLinked')}
                      </span>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {c.portal_profile_id ? (
                        <button
                          onClick={() => revoke(c.id)}
                          disabled={busyId === c.id}
                          className="text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-40 transition"
                        >
                          {busyId === c.id ? '…' : t('contactsRevoke')}
                        </button>
                      ) : (
                        <button
                          onClick={() => invite(c.id)}
                          disabled={busyId === c.id || !c.email}
                          title={!c.email ? t('contactsNoEmail') : undefined}
                          className="text-xs font-medium text-brand-orange hover:text-brand-orange-hover disabled:opacity-40 transition"
                        >
                          {busyId === c.id ? '…' : t('contactsInvite')}
                        </button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardBody>
          <h2 className="text-white font-medium text-sm mb-3">{t('contactsAddNew')}</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label={t('contactsName')} required>
              <Input size="lg" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label={t('contactsTitle')}>
              <Input size="lg" placeholder="AP, Dispatch…" value={form.title} onChange={e => set('title', e.target.value)} />
            </Field>
            <Field label={t('contactsEmail')}>
              <Input size="lg" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </Field>
            <Field label={t('contactsPhone')}>
              <Input size="lg" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </Field>
          </div>
          {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
          <Button variant="primary" onClick={addContact} disabled={adding || !form.name.trim()}>
            {adding ? '…' : t('contactsAdd')}
          </Button>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
