'use client'
// app/(admin)/admin/logs/page.tsx — Debug / Error Log viewer.
// GET /api/v1/admin/error-log (server/contract/endpoints.ts operationId
// listAdminErrorLog) reads app_error_log (migration 0038), a best-effort
// mirror of every lib/observability.ts logError() call. This is
// deliberately NOT a replacement for Sentry -- full stack traces live there
// only; this page shows short messages/context for a quick "what's
// erroring, where, for whom" triage without needing a Sentry seat.
//
// Uses components/ui/* (Card/Table/EmptyState/Input) per docs/design/
// carrieros-design-system.md §5, same layout conventions as
// app/(admin)/admin/audit/page.tsx.
import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Card, Table, TableHeaderCell, TableRow, TableCell, EmptyState, Input, Button } from '@/components/ui'

interface ErrorLogEntry {
  id: number
  route: string
  message: string
  level: string
  org_id: number | null
  org_name: string | null
  user_id: string | null
  request_id: string | null
  context: Record<string, unknown> | null
  created_at: string
}

const LIMIT = 50

// The contract's `from`/`to` are full ISO datetimes (offset required), not
// plain <input type="date"> values -- normalize the browser's YYYY-MM-DD
// into a UTC day boundary before it hits the query string.
function toIsoDateBoundary(dateStr: string, endOfDay: boolean): string | null {
  if (!dateStr) return null
  const iso = `${dateStr}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
  return new Date(iso).toISOString()
}

export default function ErrorLogPage() {
  const t = useTranslations('admin.errorLog')
  const [entries, setEntries] = useState<ErrorLogEntry[] | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState('')

  const [routeFilter, setRouteFilter] = useState('')
  const [orgIdFilter, setOrgIdFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const load = useCallback(() => {
    setEntries(null)
    setError('')
    const params = new URLSearchParams()
    if (routeFilter) params.set('route_contains', routeFilter)
    if (orgIdFilter) params.set('org_id', orgIdFilter)
    const from = toIsoDateBoundary(dateFrom, false)
    const to = toIsoDateBoundary(dateTo, true)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    params.set('limit', String(LIMIT))
    params.set('offset', String(offset))

    fetch(`/api/v1/admin/error-log?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((json) => {
        setEntries(json.entries)
        setTotal(json.total)
      })
      .catch(() => setError(t('error')))
  }, [routeFilter, orgIdFilter, dateFrom, dateTo, offset, t])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-filter-change is the intended behavior, same pattern as app/(admin)/admin/audit/page.tsx
    load()
  }, [load])

  const page = Math.floor(offset / LIMIT) + 1
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-text-pri mb-1">{t('title')}</h1>
      <p className="text-text-sec text-sm mb-2">{t('subtitle')}</p>
      <p className="text-text-mut text-xs mb-6">{t('sentryNote')}</p>

      <div className="flex flex-wrap gap-3 mb-4">
        <Input
          placeholder={t('filterRoute')}
          value={routeFilter}
          onChange={(e) => { setOffset(0); setRouteFilter(e.target.value) }}
        />
        <Input
          placeholder={t('filterOrgId')}
          value={orgIdFilter}
          onChange={(e) => { setOffset(0); setOrgIdFilter(e.target.value) }}
        />
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => { setOffset(0); setDateFrom(e.target.value) }}
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => { setOffset(0); setDateTo(e.target.value) }}
        />
      </div>

      <Card>
        {error ? (
          <div className="p-8 text-danger text-sm">{error}</div>
        ) : !entries ? (
          <div className="p-8 text-text-sec text-sm">{t('loading')}</div>
        ) : entries.length === 0 ? (
          <EmptyState icon="bug_report" title={t('noEntries')} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <TableHeaderCell>{t('colRoute')}</TableHeaderCell>
                  <TableHeaderCell>{t('colMessage')}</TableHeaderCell>
                  <TableHeaderCell>{t('colOrg')}</TableHeaderCell>
                  <TableHeaderCell>{t('colUser')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('colWhen')}</TableHeaderCell>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs text-text-pri">{e.route}</TableCell>
                    <TableCell className="text-text-sec truncate max-w-[320px]">{e.message}</TableCell>
                    <TableCell>{e.org_name ?? '—'}</TableCell>
                    <TableCell className="text-text-mut font-mono text-xs truncate max-w-[160px]">{e.user_id ?? '—'}</TableCell>
                    <TableCell numeric className="text-text-sec">{new Date(e.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
            <div className="flex items-center justify-between px-4 py-3 border-t border-divider-ui">
              <span className="text-text-mut text-xs">{t('pageInfo', { page, totalPages, total })}</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={offset <= 0} onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}>
                  {t('prev')}
                </Button>
                <Button variant="secondary" size="sm" disabled={offset + LIMIT >= total} onClick={() => setOffset((o) => o + LIMIT)}>
                  {t('next')}
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
