'use client'

import { useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { Button, Card, CardBody, Input } from '@/components/ui'

const REASONS = ['breakdown', 'traffic', 'weather', 'accident', 'customer_issue', 'other'] as const

export default function DriverLoadActions({ loadId, active }: { loadId: number; active: boolean }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [reason, setReason] = useState<(typeof REASONS)[number]>('traffic')
  const [note, setNote] = useState('')
  const [showProblem, setShowProblem] = useState(false)

  async function shareLocation() {
    setBusy(true)
    setMessage('')
    setError('')
    if (!navigator.geolocation) {
      setError('Location sharing is not supported by this browser.')
      setBusy(false)
      return
    }
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const { response } = await apiClient.http.PUT('/api/v1/loads/{id}/location', {
          params: { path: { id: loadId } },
          body: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            recorded_at: new Date(position.timestamp).toISOString(),
          },
        })
        if (!response.ok) throw new Error('location failed')
        setMessage('Location shared with dispatch.')
      } catch {
        setError('Could not share your location.')
      } finally {
        setBusy(false)
      }
    }, () => {
      setError('Location permission was denied or unavailable.')
      setBusy(false)
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 })
  }

  async function reportProblem() {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const { response } = await apiClient.http.POST('/api/v1/loads/{id}/problem-reports', {
        params: { path: { id: loadId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { reason, note: note.trim() || null },
      })
      if (!response.ok) throw new Error('report failed')
      setMessage('Problem reported to dispatch.')
      setNote('')
      setShowProblem(false)
    } catch {
      setError('Could not send the problem report.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardBody>
        <h2 className="text-text-pri font-medium text-sm mb-1">Driver actions</h2>
        <p className="text-text-sec text-xs mb-3">Share a current location or alert dispatch about a problem on this load.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={shareLocation} disabled={!active || busy}>
            {busy ? 'Working…' : 'Share current location'}
          </Button>
          <Button variant="secondary" onClick={() => setShowProblem((open) => !open)} disabled={!active || busy}>Report a problem</Button>
        </div>
        {showProblem && (
          <div className="mt-4 space-y-3 border-t border-divider-ui pt-4">
            <label className="block text-xs font-medium text-text-sec">Problem type
              <Input as="select" className="mt-1.5" value={reason} onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}>
                {REASONS.map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}
              </Input>
            </label>
            <label className="block text-xs font-medium text-text-sec">Details
              <textarea className="mt-1.5 w-full rounded-lg border border-border-ui bg-surface-input px-3 py-2 text-sm text-text-pri outline-none focus:border-brand-orange" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <Button onClick={reportProblem} disabled={busy}>Send report</Button>
          </div>
        )}
        {message && <p className="text-success text-sm mt-3">{message}</p>}
        {error && <p className="text-danger text-sm mt-3">{error}</p>}
      </CardBody>
    </Card>
  )
}
