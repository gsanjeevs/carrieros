import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'
import { getProfileForUser } from '@/lib/queries/profiles'
import { roleHasCapability } from '@/lib/generated/role-capabilities'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx
  const { supabase, user } = ctx
  const profile = (await getProfileForUser(supabase, user.id)).data
  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization', 400)
  if (!roleHasCapability(profile.role, 'loads_manage')) return apiError('FORBIDDEN', 'Load management access required', 403)

  const loadId = Number((await params).id)
  if (!Number.isSafeInteger(loadId) || loadId <= 0) return apiError('VALIDATION_ERROR', 'Invalid load id', 400)

  let input: Record<string, unknown>
  try {
    const json: unknown = await request.json()
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('invalid body')
    input = json as Record<string, unknown>
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400)
  }
  const customerOrgId = Number(input.customer_org_id)
  const orderNumber = typeof input.order_number === 'string' ? input.order_number.trim() : ''
  if (!Number.isSafeInteger(customerOrgId) || customerOrgId <= 0 || !orderNumber || orderNumber.length > 80) {
    return apiError('VALIDATION_ERROR', 'Choose a customer and provide an order number (max 80 characters)', 400)
  }
  const optionalText = (key: string, max: number) => {
    const value = input[key]
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
  }
  const rawWeight = input.weight_lbs
  const weight = rawWeight === '' || rawWeight == null ? null : Number(rawWeight)
  if (weight !== null && (!Number.isSafeInteger(weight) || weight <= 0 || weight > 100_000)) {
    return apiError('VALIDATION_ERROR', 'Weight must be between 1 and 100,000 lb', 400)
  }
  const rawAmount = input.billable_amount
  const billableAmount = rawAmount === '' || rawAmount == null ? null : Number(rawAmount)
  if (billableAmount !== null && (!Number.isFinite(billableAmount) || billableAmount < 0 || Math.round(billableAmount * 100) !== billableAmount * 100)) {
    return apiError('VALIDATION_ERROR', 'Order charge must be a non-negative amount with at most two decimals', 400)
  }

  const { data: load } = await supabase.from('loads').select('rate').eq('id', loadId).eq('carrier_org_id', profile.org_id).maybeSingle()
  if (!load) return apiError('NOT_FOUND', 'Load not found', 404)
  const { data: existingOrders } = await supabase.from('load_orders').select('id').eq('load_id', loadId)
  // If this is the first customer order, default its charge to the full load rate.
  // Additional customers need an explicit allocation from a billing-capable user.
  const initialCharge = billableAmount ?? (!existingOrders?.length && roleHasCapability(profile.role, 'invoice_actions') ? Number(load.rate ?? 0) : null)

  const { data, error } = await supabase.from('load_orders').insert({
    carrier_org_id: profile.org_id,
    load_id: loadId,
    customer_org_id: customerOrgId,
    order_number: orderNumber,
    customer_reference: optionalText('customer_reference', 100),
    commodity: optionalText('commodity', 120),
    weight_lbs: weight,
    billable_amount: initialCharge,
  }).select('id, order_number, customer_reference, commodity, weight_lbs, customer_org_id, billable_amount').single()
  if (error || !data) {
    const message = error?.code === '23505' ? 'That order number is already in use' : 'Could not add customer order'
    return apiError(error?.code === '23505' ? 'VALIDATION_ERROR' : 'SERVER_ERROR', message, error?.code === '23505' ? 409 : 500)
  }
  return NextResponse.json({
    order: {
      id: data.id,
      order_number: data.order_number,
      customer_reference: data.customer_reference,
      commodity: data.commodity,
      weight_lbs: data.weight_lbs,
      customer_org_id: data.customer_org_id,
      billable_amount: roleHasCapability(profile.role, 'invoice_actions') ? data.billable_amount : null,
    },
  }, { status: 201 })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await getAuthedContext(request)
  if (isErrorResponse(context)) return context
  const { supabase, user } = context
  const profile = (await getProfileForUser(supabase, user.id)).data
  if (!profile?.org_id) return apiError('NOT_ONBOARDED', 'No organization', 400)
  if (!roleHasCapability(profile.role, 'invoice_actions')) return apiError('FORBIDDEN', 'Billing access required', 403)
  const loadId = Number((await params).id)
  if (!Number.isSafeInteger(loadId) || loadId <= 0) return apiError('VALIDATION_ERROR', 'Invalid load id', 400)
  const body: unknown = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('VALIDATION_ERROR', 'Invalid request body', 400)
  const input = body as Record<string, unknown>
  const orderId = Number(input.order_id)
  const rawAmount = input.billable_amount
  const amount = rawAmount === '' || rawAmount == null ? null : Number(rawAmount)
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || (amount !== null && (!Number.isFinite(amount) || amount < 0 || Math.round(amount * 100) !== amount * 100))) {
    return apiError('VALIDATION_ERROR', 'Enter a non-negative amount with at most two decimals', 400)
  }
  const { data: loadOrder, error: loadOrderError } = await supabase.from('load_orders')
    .select('id').eq('id', orderId).eq('load_id', loadId).eq('carrier_org_id', profile.org_id).maybeSingle()
  if (loadOrderError || !loadOrder) return apiError('NOT_FOUND', 'Order not found', 404)
  const { data, error } = await supabase.rpc('set_load_order_billable_amount', { p_order_id: orderId, p_amount: amount })
  if (error?.code === 'PT409') return apiError('VALIDATION_ERROR', 'Order charges cannot change after an invoice is created', 409)
  if (error?.code === 'PT400') return apiError('VALIDATION_ERROR', 'Order charge must not exceed the load rate', 400)
  if (error?.code === 'PT404') return apiError('NOT_FOUND', 'Order not found', 404)
  if (error) return apiError('SERVER_ERROR', 'Could not save this order charge', 500)
  return NextResponse.json({ order_id: orderId, billable_amount: data })
}
