'use client'

import { useRef, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { Button, Card, CardBody, Input } from '@/components/ui'

const AREAS = ['brakes', 'lights', 'tires', 'steering', 'horn', 'mirrors', 'coupling_devices', 'emergency_equipment'] as const
type Area = (typeof AREAS)[number]
type Defect = { selected: boolean; description: string; severity: 'minor' | 'major'; photo: File | null }

const EMPTY_DEFECT = (): Defect => ({ selected: false, description: '', severity: 'minor', photo: null })

async function attach(inspectionId: number, body: { kind: 'signature' } | { kind: 'defect_photo'; area: Area }, bytes: ArrayBuffer, contentType: 'image/png' | 'image/jpeg') {
  const slot = await apiClient.http.POST('/api/v1/dvir-inspections/{id}/attachment-uploads', {
    params: { path: { id: inspectionId } },
    body: { ...body, content_type: contentType },
  })
  if (!slot.data) throw new Error('attachment slot failed')
  const put = await fetch(slot.data.upload_url, { method: 'PUT', headers: { 'Content-Type': slot.data.content_type }, body: bytes })
  if (!put.ok) throw new Error('attachment upload failed')
  const finalized = await apiClient.http.POST('/api/v1/dvir-inspections/{id}/attachments', {
    params: { path: { id: inspectionId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
    body: { ...body, storage_path: slot.data.storage_path },
  })
  if (!finalized.response.ok) throw new Error('attachment finalize failed')
}

export default function DvirForm({ loadId }: { loadId: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [type, setType] = useState<'pre_trip' | 'post_trip'>('pre_trip')
  const [odometer, setOdometer] = useState('')
  const [defects, setDefects] = useState<Record<Area, Defect>>(() => Object.fromEntries(AREAS.map((area) => [area, EMPTY_DEFECT()])) as Record<Area, Defect>)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) }
  }

  function startSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    const p = point(event)
    if (!p) return
    canvasRef.current?.setPointerCapture(event.pointerId)
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    drawing.current = true
  }

  function drawSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const p = point(event)
    const ctx = canvasRef.current?.getContext('2d')
    if (!p || !ctx) return
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  function clearSignature() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  function setDefect(area: Area, update: Partial<Defect>) {
    setDefects((current) => ({ ...current, [area]: { ...current[area], ...update } }))
  }

  async function submit() {
    setBusy(true)
    setMessage('')
    setError('')
    const selected = AREAS.filter((area) => defects[area].selected)
    if (!canvasRef.current || canvasRef.current.toDataURL() === canvasRef.current.toDataURL('image/png', 0)) {
      setError('Please sign the inspection before submitting.')
      setBusy(false)
      return
    }
    if (selected.some((area) => !defects[area].description.trim())) {
      setError('Add a description for every reported defect.')
      setBusy(false)
      return
    }
    try {
      const report = await apiClient.http.POST('/api/v1/loads/{id}/dvir-inspections', {
        params: { path: { id: loadId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: {
          type,
          odometer: odometer ? Number(odometer) : null,
          defects: selected.map((area) => ({ area, description: defects[area].description.trim(), severity: defects[area].severity })),
        },
      })
      if (!report.response.ok || !report.data) throw new Error('inspection failed')
      const signatureBytes = await (await fetch(canvasRef.current.toDataURL('image/png'))).arrayBuffer()
      const warnings: string[] = []
      try { await attach(report.data.id, { kind: 'signature' }, signatureBytes, 'image/png') } catch { warnings.push('signature') }
      for (const area of selected) {
        const photo = defects[area].photo
        if (!photo) continue
        try { await attach(report.data.id, { kind: 'defect_photo', area }, await photo.arrayBuffer(), 'image/jpeg') } catch { warnings.push(`${area} photo`) }
      }
      setMessage(warnings.length ? `Inspection submitted. Could not upload: ${warnings.join(', ')}.` : 'Inspection submitted successfully.')
      clearSignature()
      setDefects(Object.fromEntries(AREAS.map((area) => [area, EMPTY_DEFECT()])) as Record<Area, Defect>)
      setOdometer('')
    } catch {
      setError('Could not submit the inspection. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div><h2 className="text-text-pri font-medium text-sm">File DVIR</h2><p className="text-text-sec text-xs mt-1">Complete a pre-trip or post-trip inspection.</p></div>
          <Input as="select" value={type} onChange={(e) => setType(e.target.value as 'pre_trip' | 'post_trip')}>
            <option value="pre_trip">Pre-trip</option><option value="post_trip">Post-trip</option>
          </Input>
        </div>
        <label className="block text-xs font-medium text-text-sec mb-4">Odometer
          <Input type="number" min="0" className="mt-1.5" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
        </label>
        <div className="space-y-2">
          {AREAS.map((area) => {
            const defect = defects[area]
            return <div key={area} className="rounded-lg border border-border-ui p-3">
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={defect.selected} onChange={(e) => setDefect(area, { selected: e.target.checked })} />
                <span className="text-text-pri text-sm capitalize">{area.replace('_', ' ')}</span>
                {defect.selected && <Input as="select" className="ml-auto w-auto" value={defect.severity} onChange={(e) => setDefect(area, { severity: e.target.value as 'minor' | 'major' })}><option value="minor">Minor</option><option value="major">Major</option></Input>}
              </div>
              {defect.selected && <div className="grid sm:grid-cols-2 gap-2 mt-3"><Input placeholder="Describe the defect" value={defect.description} onChange={(e) => setDefect(area, { description: e.target.value })} /><Input type="file" accept="image/jpeg,image/png" onChange={(e) => setDefect(area, { photo: e.target.files?.[0] ?? null })} /></div>}
            </div>
          })}
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2"><p className="text-xs font-medium text-text-sec">Signature</p><button type="button" onClick={clearSignature} className="text-xs text-brand-orange">Clear</button></div>
          <canvas ref={canvasRef} width={720} height={180} className="w-full h-32 rounded-lg border border-border-ui bg-white touch-none" onPointerDown={startSignature} onPointerMove={drawSignature} onPointerUp={() => { drawing.current = false }} onPointerLeave={() => { drawing.current = false }} />
        </div>
        {error && <p className="text-danger text-sm mt-3">{error}</p>}
        {message && <p className="text-success text-sm mt-3">{message}</p>}
        <Button className="mt-4" onClick={submit} disabled={busy} loading={busy}>{busy ? 'Submitting…' : 'Submit inspection'}</Button>
      </CardBody>
    </Card>
  )
}
