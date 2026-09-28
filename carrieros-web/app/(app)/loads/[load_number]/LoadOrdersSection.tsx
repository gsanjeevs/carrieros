'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { formatMoney } from '@/lib/format-money'
import { Card, CardBody, CardHeader, Button } from '@/components/ui'

type CustomerOrder = {
  id: number
  order_number: string
  customer_reference: string | null
  commodity: string | null
  weight_lbs: number | null
  customer_org_id: number
  customer_name: string
  billable_amount: number | null
}
type CustomerOption = { id: number; name: string }

export default function LoadOrdersSection({
  loadId, orders: initialOrders, customers, canAdd, canBill, loadRate, currency, locale,
}: {
  loadId: number
  orders: CustomerOrder[]
  customers: CustomerOption[]
  canAdd: boolean
  canBill: boolean
  loadRate: number | null
  currency: string
  locale: string
}) {
  const t = useTranslations('loads')
  const [orders, setOrders] = useState(initialOrders)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingChargeId, setSavingChargeId] = useState<number | null>(null)
  const allocated = orders.reduce((sum, order) => sum + (order.billable_amount ?? 0), 0)
  const allocationComplete = orders.every((order) => order.billable_amount !== null) && Math.round(allocated * 100) === Math.round(Number(loadRate ?? 0) * 100)

  async function updateCharge(orderId: number, formData: FormData) {
    setSavingChargeId(orderId)
    setError('')
    const raw = formData.get('billable_amount')
    const amount = raw === '' ? null : Number(raw)
    try {
      const response = await fetch(`/api/loads/${loadId}/orders`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, billable_amount: amount }),
      })
      if (!response.ok) throw new Error(t('orderChargeUpdateFailed'))
      const result = await response.json()
      setOrders((current) => current.map((order) => order.id === orderId ? { ...order, billable_amount: result.billable_amount } : order))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('orderChargeUpdateFailed'))
    } finally {
      setSavingChargeId(null)
    }
  }

  async function addOrder(formData: FormData) {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/loads/${loadId}/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_org_id: Number(formData.get('customer_org_id')),
          order_number: formData.get('order_number'),
          customer_reference: formData.get('customer_reference'),
          commodity: formData.get('commodity'),
          weight_lbs: formData.get('weight_lbs'),
          billable_amount: canBill ? formData.get('billable_amount') : null,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(t('ordersAddFailed'))
      const customer = customers.find((option) => option.id === body.order.customer_org_id)
      setOrders((current) => [...current, { ...body.order, billable_amount: body.order.billable_amount ?? null, customer_name: customer?.name ?? t('customer') }])
      ;(document.getElementById(`add-order-${loadId}`) as HTMLFormElement | null)?.reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ordersAddFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('customerOrders')} <span className="text-text-mut">({orders.length})</span></h2></CardHeader>
      <CardBody>
        {orders.length ? (
          <div className="space-y-3">
            {canBill && (
              <p className={`rounded-lg px-3 py-2 text-xs ${allocationComplete ? 'bg-status-success-surface text-status-success' : 'bg-status-warning-surface text-status-warning'}`}>
                {allocationComplete
                  ? t('orderAllocationComplete', { allocated: formatMoney(allocated, currency, locale) })
                  : t('orderAllocationIncomplete', { allocated: formatMoney(allocated, currency, locale), target: formatMoney(loadRate ?? 0, currency, locale) })}
              </p>
            )}
            {orders.map((order) => (
              <div key={order.id} className="rounded-lg border border-border-ui p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong className="text-text-pri text-sm">{order.order_number}</strong>
                  <span className="text-text-sec text-sm">{order.customer_name}</span>
                </div>
                {order.customer_reference && <p className="text-text-mut text-xs mt-1">{t('orderReference')}: {order.customer_reference}</p>}
                <p className="text-text-sec text-xs mt-1">{order.commodity ?? '—'}{order.weight_lbs ? ` · ${Number(order.weight_lbs).toLocaleString()} lb` : ''}</p>
                {canBill && (
                  <form action={(data) => updateCharge(order.id, data)} className="mt-3 flex flex-wrap items-end gap-2 border-t border-divider-ui pt-3">
                    <label key={`${order.id}-${order.billable_amount}`} className="min-w-36 flex-1 text-xs text-text-sec">
                      {t('orderCharge')}
                      <input name="billable_amount" type="number" min="0" max={loadRate ?? undefined} step="0.01" required defaultValue={order.billable_amount ?? ''} className="mt-1 w-full rounded-md border border-border-ui bg-surface-card px-3 py-2 text-sm text-text-pri" />
                    </label>
                    <Button type="submit" size="sm" variant="secondary" disabled={savingChargeId === order.id}>
                      {savingChargeId === order.id ? t('savingOrder') : t('saveOrderCharge')}
                    </Button>
                  </form>
                )}
              </div>
            ))}
          </div>
        ) : <p className="text-text-sec text-sm">{t('noCustomerOrders')}</p>}
        {canAdd && customers.length > 0 && (
          <form id={`add-order-${loadId}`} action={addOrder} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-divider-ui pt-4">
            <select name="customer_org_id" required defaultValue="" aria-label={t('customer')} className="rounded-md border border-border-ui bg-surface-card px-3 py-2 text-sm text-text-pri">
              <option value="" disabled>{t('selectOrderCustomer')}</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
            <input name="order_number" required maxLength={80} placeholder={t('orderNumber')} aria-label={t('orderNumber')} className="rounded-md border border-border-ui bg-surface-card px-3 py-2 text-sm text-text-pri" />
            <input name="customer_reference" maxLength={100} placeholder={t('orderReference')} aria-label={t('orderReference')} className="rounded-md border border-border-ui bg-surface-card px-3 py-2 text-sm text-text-pri" />
            <input name="commodity" maxLength={120} placeholder={t('commodity')} aria-label={t('commodity')} className="rounded-md border border-border-ui bg-surface-card px-3 py-2 text-sm text-text-pri" />
            <input name="weight_lbs" type="number" min="1" max="100000" placeholder={t('orderWeight')} aria-label={t('orderWeight')} className="rounded-md border border-border-ui bg-surface-card px-3 py-2 text-sm text-text-pri" />
            {canBill && <input name="billable_amount" type="number" min="0" max={loadRate ?? undefined} step="0.01" placeholder={t('orderCharge')} aria-label={t('orderCharge')} className="rounded-md border border-border-ui bg-surface-card px-3 py-2 text-sm text-text-pri" />}
            <Button type="submit" size="sm" disabled={saving}>{saving ? t('savingOrder') : t('addCustomerOrder')}</Button>
          </form>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-status-danger">{error}</p>}
        <p className="mt-3 text-text-mut text-xs">{t('ordersKeepCustomerScoped')}</p>
      </CardBody>
    </Card>
  )
}
