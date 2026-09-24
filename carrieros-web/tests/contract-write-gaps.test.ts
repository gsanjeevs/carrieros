import { describe, expect, it } from 'vitest'
import { buildOpenApi } from '@/server/contract/openapi'
import { AssignLoadResponseSchema, ListDriversResponseSchema } from '@/server/contract/schemas'

type Operation = {
  operationId: string
  requestBody?: unknown
  responses: Record<string, unknown>
}

const document = buildOpenApi()
const paths = document.paths as Record<string, Record<string, Operation>>

describe('mobile migration write-gap contract', () => {
  it.each([
    ['post', '/api/v1/loads', 'createLoad', '201'],
    ['patch', '/api/v1/loads/{id}', 'assignLoad', '200'],
    ['post', '/api/v1/invoices/{id}/send', 'sendInvoice', '200'],
    ['post', '/api/v1/onboarding', 'completeOnboarding', '201'],
    ['post', '/api/v1/billing/payment-method', 'addPaymentMethod', '200'],
    ['post', '/api/v1/customers', 'createCustomer', '201'],
    ['post', '/api/v1/vehicles', 'createVehicle', '201'],
    ['get', '/api/v1/drivers', 'listDrivers', '200'],
    ['post', '/api/v1/driver-messages', 'sendDriverMessage', '201'],
  ])('registers %s %s as %s with success status %s', (method, path, operationId, successStatus) => {
    const operation = paths[path]?.[method]

    expect(operation?.operationId).toBe(operationId)
    expect(operation?.responses).toHaveProperty(successStatus)
  })

  it('preserves reads when a write shares the resource path', () => {
    expect(paths['/api/v1/loads']).toMatchObject({
      get: { operationId: 'listLoads' },
      post: { operationId: 'createLoad' },
    })
    expect(paths['/api/v1/loads/{id}']).toMatchObject({
      get: { operationId: 'getLoad' },
      patch: { operationId: 'assignLoad' },
    })
    expect(paths['/api/v1/customers']).toMatchObject({
      get: { operationId: 'listCustomers' },
      post: { operationId: 'createCustomer' },
    })
    expect(paths['/api/v1/vehicles']).toMatchObject({
      get: { operationId: 'listVehicles' },
      post: { operationId: 'createVehicle' },
    })
  })

  it('matches the legacy load-update and driver-list response envelopes', () => {
    const assignResponse = paths['/api/v1/loads/{id}'].patch.responses['200'] as {
      content: { 'application/json': { schema: Record<string, unknown> } }
    }
    const driversResponse = paths['/api/v1/drivers'].get.responses['200'] as {
      content: { 'application/json': { schema: Record<string, unknown> } }
    }

    expect(assignResponse.content['application/json'].schema).toMatchObject({
      type: 'object',
      required: ['ok'],
      properties: { ok: { type: 'boolean' } },
    })
    expect(driversResponse.content['application/json'].schema).toMatchObject({ type: 'array' })
    expect(AssignLoadResponseSchema.safeParse({ ok: true }).success).toBe(true)
    expect(AssignLoadResponseSchema.safeParse({ ok: false }).success).toBe(false)
    expect(ListDriversResponseSchema.safeParse([]).success).toBe(true)
    expect(ListDriversResponseSchema.safeParse({ drivers: [] }).success).toBe(false)
  })

  it('does not publish the deferred translation operation', () => {
    expect(Object.keys(paths).some((path) => path.includes('translate'))).toBe(false)
  })
})
