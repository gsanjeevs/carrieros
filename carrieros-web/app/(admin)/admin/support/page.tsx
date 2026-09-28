'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button, Card, EmptyState, Input, KpiTile, StatusBadge, Table, TableCell, TableHeaderCell, TableRow } from '@/components/ui'

type QueueStatus = 'all' | 'open' | 'resolved' | 'closed'

interface Ticket {
  id: number
  carrier_org_id: number
  organization_name: string | null
  submitter_name: string | null
  submitter_role: string
  category: string
  related_load_number: string | null
  body_preview: string
  status: Exclude<QueueStatus, 'all'>
  created_at: string
  updated_at: string
}

interface QueueResponse {
  tickets: Ticket[]
  counts: { open: number; resolved: number; closed: number }
  has_more: boolean
}

const PAGE_SIZE = 50

export default function SupportInboxPage() {
  const t = useTranslations('admin.supportInbox')
  const [status, setStatus] = useState<QueueStatus>('open')
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [counts, setCounts] = useState({ open: 0, resolved: 0, closed: 0 })
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      const params = new URLSearchParams({ status, page: String(page) })
      if (search) params.set('q', search)
      try {
        const response = await fetch(`/api/admin/support-tickets?${params}`)
        if (!response.ok) throw new Error()
        const data: QueueResponse = await response.json()
        if (cancelled) return
        setTickets(current => page === 0 ? data.tickets : [...current, ...data.tickets])
        setCounts(data.counts)
        setHasMore(data.has_more)
      } catch {
        if (!cancelled) setError(t('error'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 150)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [status, page, search, t])

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (searchDraft.trim() === search) return
    setTickets([])
    setPage(0)
    setSearch(searchDraft.trim())
  }

  function changeStatus(next: QueueStatus) {
    if (next === status) return
    setTickets([])
    setPage(0)
    setStatus(next)
  }

  const filters: QueueStatus[] = ['open', 'resolved', 'closed', 'all']

  return (
    <div className="p-8 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-text-pri mb-1">{t('title')}</h1>
        <p className="text-text-sec text-sm">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiTile label={t('openCount')} value={counts.open} />
        <KpiTile label={t('resolvedCount')} value={counts.resolved} />
        <KpiTile label={t('closedCount')} value={counts.closed} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2" role="group" aria-label={t('statusFiltersLabel')}>
          {filters.map(filter => (
            <Button key={filter} size="sm" variant={status === filter ? 'primary' : 'secondary'} onClick={() => changeStatus(filter)}>
              {t(`${filter}Filter`)}
            </Button>
          ))}
        </div>
        <form className="flex gap-2 w-full sm:w-auto" onSubmit={applySearch}>
          <Input value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} />
          <Button type="submit" variant="secondary">{t('search')}</Button>
        </form>
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Card>
        {tickets.length === 0 && !loading ? <EmptyState icon="inbox" title={t('noTickets')} /> : (
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>{t('ticketColumn')}</TableHeaderCell>
                <TableHeaderCell>{t('orgColumn')}</TableHeaderCell>
                <TableHeaderCell>{t('submitterColumn')}</TableHeaderCell>
                <TableHeaderCell>{t('statusColumn')}</TableHeaderCell>
                <TableHeaderCell>{t('updatedColumn')}</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {tickets.map(ticket => (
                <TableRow key={ticket.id}>
                  <TableCell>
                    <Link href={`/admin/support/${ticket.id}`} className="font-medium text-text-pri hover:text-brand-orange">#{ticket.id} · {ticket.category}</Link>
                    <p className="mt-1 max-w-xl truncate text-xs text-text-mut">{ticket.body_preview}</p>
                  </TableCell>
                  <TableCell>
                    <Link href={`/admin/orgs/${ticket.carrier_org_id}`} className="text-text-sec hover:text-brand-orange">{ticket.organization_name ?? `#${ticket.carrier_org_id}`}</Link>
                  </TableCell>
                  <TableCell className="text-text-sec">{ticket.submitter_name ?? t('unknownUser')}<span className="block text-xs text-text-mut">{ticket.submitter_role}</span></TableCell>
                  <TableCell><StatusBadge variant={ticket.status === 'open' ? 'warning' : ticket.status === 'resolved' ? 'success' : 'info'} size="sm">{t(`${ticket.status}Filter`)}</StatusBadge></TableCell>
                  <TableCell className="text-xs text-text-mut">{new Date(ticket.updated_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="flex justify-center">
        {hasMore ? (
          <Button variant="secondary" onClick={() => setPage(current => current + 1)} loading={loading}>{t('loadMore')}</Button>
        ) : tickets.length > 0 && <p className="text-xs text-text-mut">{t('allResultsLoaded')}</p>}
        {loading && tickets.length === 0 && <p className="text-xs text-text-mut">{t('loading')}</p>}
      </div>
      {tickets.length > 0 && <p className="text-xs text-text-mut">{t('pageHint', { count: tickets.length, pageSize: PAGE_SIZE })}</p>}
    </div>
  )
}
