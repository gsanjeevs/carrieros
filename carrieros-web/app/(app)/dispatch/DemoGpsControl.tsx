'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui'

type DemoLoadOption = { id: number; loadNumber: string; customer: string | null; destination: string | null }

export default function DemoGpsControl({ loads }: { loads: DemoLoadOption[] }) {
  const t = useTranslations('dispatch')
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [loadId, setLoadId] = useState(loads[0]?.id ? String(loads[0].id) : '')
  const tick = useRef(0)
  const interval = useRef<ReturnType<typeof setInterval> | null>(null)
  const sending = useRef(false)

  async function publish() {
    if (sending.current) return
    sending.current = true
    try {
      const response = await fetch('/api/demo/gps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tick: tick.current++, load_id: Number(loadId) }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || t('demoGpsError'))
      setMessage(t('demoGpsUpdated', { count: result.updated }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('demoGpsError'))
      setRunning(false)
      if (interval.current) clearInterval(interval.current)
      interval.current = null
    } finally {
      sending.current = false
    }
  }

  function start() {
    if (interval.current) return
    if (!loadId) {
      setMessage(t('demoGpsNoLoads'))
      return
    }
    setMessage('')
    setRunning(true)
    void publish()
    interval.current = setInterval(() => void publish(), 4000)
  }

  function stop() {
    setRunning(false)
    if (interval.current) clearInterval(interval.current)
    interval.current = null
    setMessage(t('demoGpsStopped'))
  }

  useEffect(() => () => {
    if (interval.current) clearInterval(interval.current)
  }, [])

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="sr-only" htmlFor="demo-gps-load">{t('demoGpsSelectLoad')}</label>
      <select
        id="demo-gps-load"
        value={loadId}
        onChange={(event) => setLoadId(event.target.value)}
        disabled={running || loads.length === 0}
        className="rounded-lg border border-border-ui bg-surface-card px-3 py-2 text-sm text-text-pri disabled:opacity-50"
      >
        {loads.length === 0 ? <option value="">{t('demoGpsNoLoads')}</option> : loads.map((load) => (
          <option key={load.id} value={load.id}>{load.loadNumber} · {load.customer ?? t('customerUnassigned')} · {load.destination ?? t('destination')}</option>
        ))}
      </select>
      {running ? (
        <Button variant="secondary" size="sm" onClick={stop}>{t('demoGpsStop')}</Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={start} disabled={loads.length === 0}>{t('demoGpsStart')}</Button>
      )}
      <span className="text-xs text-text-sec">{running ? t('demoGpsRunning') : t('demoGpsHelp')}</span>
      {message && <span role="status" className="text-xs text-text-mut">{message}</span>}
    </div>
  )
}
