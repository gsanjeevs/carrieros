// GET /api/public/v1/openapi.json — the public developer API's own OpenAPI
// 3.x document, generated live from server/contract/public-*.ts (the same
// zod schemas the routes themselves validate against) rather than
// hand-maintained prose. No auth: a prospective integrator must be able to
// read the spec before they have a client_id at all.
import { NextResponse } from 'next/server'
import { buildPublicOpenApi } from '@/server/contract/public-openapi'

export async function GET() {
  return NextResponse.json(buildPublicOpenApi())
}
