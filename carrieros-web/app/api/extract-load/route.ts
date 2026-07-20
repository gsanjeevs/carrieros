// app/api/extract-load/route.ts
import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedContext, isErrorResponse, apiError } from '@/lib/api-auth'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const SYSTEM_PROMPT = `You are a load extraction assistant for a trucking company.
Extract structured load data from rate confirmations, emails, and broker documents.
Return ONLY valid JSON matching the schema below. If a field cannot be determined, use null.
Do not include any explanation or text outside the JSON.`

const SCHEMA = `{
  "customer_name_raw": string | null,       // Broker or shipper company name
  "load_number_raw": string | null,         // Load/reference number from the document
  "pickup_address": string | null,
  "pickup_city": string | null,
  "pickup_state": string | null,            // 2-letter state code
  "pickup_zip": string | null,
  "pickup_date": string | null,             // YYYY-MM-DD
  "pickup_time": string | null,             // HH:MM (24h)
  "delivery_address": string | null,
  "delivery_city": string | null,
  "delivery_state": string | null,          // 2-letter state code
  "delivery_zip": string | null,
  "delivery_date": string | null,           // YYYY-MM-DD
  "delivery_time": string | null,           // HH:MM (24h)
  "commodity": string | null,
  "weight_lbs": number | null,              // numeric pounds only
  "rate": number | null,                    // numeric dollars only, no $ sign
  "total_miles": number | null,             // if mentioned
  "confidence": {
    "pickup": "high" | "medium" | "low",
    "delivery": "high" | "medium" | "low",
    "rate": "high" | "medium" | "low",
    "dates": "high" | "medium" | "low"
  }
}`

export async function POST(request: NextRequest) {
  // Any authenticated carrier user (web or mobile) may extract a load —
  // this just needs *a* valid session, not org/role checks, since the
  // caller hasn't created a load yet at this point.
  const ctx = await getAuthedContext(request)
  if (isErrorResponse(ctx)) return ctx

  if (!process.env.ANTHROPIC_API_KEY) {
    return apiError('SERVER_ERROR', 'ANTHROPIC_API_KEY not configured', 500)
  }

  let text: string
  try {
    const body = await request.json()
    text = body.text
    if (!text || typeof text !== 'string' || text.trim().length < 10) {
      return apiError('VALIDATION_ERROR', 'Text is required', 400)
    }
  } catch {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400)
  }

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Extract load data from this rate confirmation. Return JSON matching this schema:\n${SCHEMA}\n\nDocument:\n${text}`,
        },
      ],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text : ''

    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    const extracted = JSON.parse(cleaned)
    return NextResponse.json(extracted)
  } catch (err) {
    console.error('[extract-load] error:', err)
    return apiError('EXTRACTION_FAILED', 'Extraction failed. Check your API key and try again.', 500)
  }
}
