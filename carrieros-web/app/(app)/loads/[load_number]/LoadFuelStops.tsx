'use client'

import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { Button, Card, CardBody, Input } from '@/components/ui'

type FuelStop = { id: number; state: string; station: string | null; gallons: number; total_cost: number; has_receipt: boolean }

export default function LoadFuelStops({ loadId }: { loadId: number }) {
  const [stops, setStops] = useState<FuelStop[]>([])
  const [open, setOpen] = useState(false)
  const [state, setState] = useState('')
  const [station, setStation] = useState('')
  const [gallons, setGallons] = useState('')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    apiClient.http.GET('/api/v1/loads/{id}/fuel-stops', { params: { path: { id: loadId } } }).then(({ data }) => {
      if (!mounted) return
      setStops((data?.fuel_stops as FuelStop[] | undefined) ?? [])
      setBusy(false)
    }).catch(() => {
      if (mounted) setBusy(false)
    })
    return () => { mounted = false }
  }, [loadId])

  async function save() {
    const gallonsNumber = Number(gallons)
    const priceNumber = price ? Number(price) : null
    if (!/^[A-Za-z]{2}$/.test(state) || !Number.isFinite(gallonsNumber) || gallonsNumber <= 0) {
      setError('Enter a two-letter state and a positive gallon amount.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { response } = await apiClient.http.POST('/api/v1/loads/{id}/fuel-stops', {
        params: { path: { id: loadId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { state: state.toUpperCase(), station: station.trim() || null, gallons: gallonsNumber, price_per_gallon: priceNumber },
      })
      if (!response.ok) throw new Error('save failed')
      setState(''); setStation(''); setGallons(''); setPrice(''); setOpen(false)
      const { data } = await apiClient.http.GET('/api/v1/loads/{id}/fuel-stops', { params: { path: { id: loadId } } })
      setStops((data?.fuel_stops as FuelStop[] | undefined) ?? [])
      setBusy(false)
    } catch {
      setError('Could not save the fuel stop.')
      setBusy(false)
    }
  }

  const totalCost = stops.reduce((sum, stop) => sum + Number(stop.total_cost), 0)
  const totalGallons = stops.reduce((sum, stop) => sum + Number(stop.gallons), 0)
  if (busy && stops.length === 0 && !open) return null

  return <Card>
    <CardBody>
      <div className="flex items-center justify-between mb-3"><div><h2 className="text-text-pri font-medium text-sm">Fuel stops</h2><p className="text-text-sec text-xs mt-1">{stops.length} stops · {totalGallons.toLocaleString()} gal · ${totalCost.toFixed(2)}</p></div><Button variant="secondary" onClick={() => setOpen((value) => !value)} disabled={busy}>{open ? 'Cancel' : 'Add fuel stop'}</Button></div>
      {open && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4"><Input maxLength={2} placeholder="State" value={state} onChange={(e) => setState(e.target.value.toUpperCase())} /><Input placeholder="Station" value={station} onChange={(e) => setStation(e.target.value)} /><Input type="number" min="0" step="0.001" placeholder="Gallons" value={gallons} onChange={(e) => setGallons(e.target.value)} /><Input type="number" min="0" step="0.001" placeholder="Price / gal" value={price} onChange={(e) => setPrice(e.target.value)} /><Button onClick={save} disabled={busy}>Save</Button></div>}
      {error && <p className="text-danger text-sm mb-3">{error}</p>}
      {stops.length === 0 ? <p className="text-text-mut text-sm">No fuel stops yet.</p> : <div className="divide-y divide-divider-ui">{stops.map((stop) => <div key={stop.id} className="flex justify-between py-2 text-sm"><span className="text-text-pri">{stop.state} · {stop.station ?? '—'}</span><span className="text-text-sec">{Number(stop.gallons).toLocaleString()} gal · ${Number(stop.total_cost).toFixed(2)}{stop.has_receipt ? ' · receipt' : ''}</span></div>)}</div>}
    </CardBody>
  </Card>
}
