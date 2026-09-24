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
    // API-completeness round 2 (2026-09-24): items never scoped into the
    // first write-gap pass, built once the user rejected phased/MVP delivery.
    ['patch', '/api/v1/customers/{id}', 'updateCustomer', '200'],
    ['patch', '/api/v1/vehicles/{id}', 'updateVehicle', '200'],
    ['post', '/api/v1/billing/change-tier', 'changeTier', '200'],
    ['post', '/api/v1/driver-messages/{id}/translate', 'translateDriverMessage', '200'],
    ['get', '/api/v1/messages', 'listConversations', '200'],
    ['post', '/api/v1/org-documents/uploads', 'requestOrgDocumentUpload', '200'],
    ['post', '/api/v1/org-documents', 'finalizeOrgDocument', '201'],
    ['get', '/api/v1/org-documents', 'listOrgDocuments', '200'],
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
    expect(paths['/api/v1/customers/{id}']).toMatchObject({
      get: { operationId: 'getCustomer' },
      patch: { operationId: 'updateCustomer' },
    })
    expect(paths['/api/v1/vehicles/{id}']).toMatchObject({
      get: { operationId: 'getVehicle' },
      patch: { operationId: 'updateVehicle' },
    })
    expect(paths['/api/v1/org-documents']).toMatchObject({
      get: { operationId: 'listOrgDocuments' },
      post: { operationId: 'finalizeOrgDocument' },
    })
  })

  it('matches the LoadWriteService.assign() and listDrivers() response envelopes', () => {
    const assignResponse = paths['/api/v1/loads/{id}'].patch.responses['200'] as {
      content: { 'application/json': { schema: Record<string, unknown> } }
    }
    const driversResponse = paths['/api/v1/drivers'].get.responses['200'] as {
      content: { 'application/json': { schema: Record<string, unknown> } }
    }

    expect(assignResponse.content['application/json'].schema).toMatchObject({
      type: 'object',
      required: ['outcome', 'load_id'],
      properties: { outcome: { type: 'string' }, load_id: { type: 'integer' } },
    })
    expect(driversResponse.content['application/json'].schema).toMatchObject({ type: 'object' })
    expect(AssignLoadResponseSchema.safeParse({ outcome: 'APPLIED', load_id: 1 }).success).toBe(true)
    expect(AssignLoadResponseSchema.safeParse({ ok: true }).success).toBe(false)
    expect(ListDriversResponseSchema.safeParse({ drivers: [] }).success).toBe(true)
    expect(ListDriversResponseSchema.safeParse([]).success).toBe(false)
  })

  it('publishes the real (LLM-backed) translation operation — no longer deferred', () => {
    const op = paths['/api/v1/driver-messages/{id}/translate']?.post
    expect(op?.operationId).toBe('translateDriverMessage')
  })
})
