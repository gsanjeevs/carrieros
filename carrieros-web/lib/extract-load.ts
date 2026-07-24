// lib/extract-load.ts
// The Anthropic load-extraction call, factored out of
// app/api/extract-load/route.ts so a second caller — the inbound-email
// intake webhook (app/api/intake/email/route.ts) — can reuse the exact
// same model call/schema/failure-mode classification without an HTTP
// round trip to itself. The route keeps the user-session auth check (paste-
// to-extract is a logged-in action); this function has no auth concept of
// its own, matching what it actually does (call an LLM, return JSON).
//
// extractLoadFromImage (added for the mobile photo-intake gap,
// app/api/extract-load-image/route.ts) shares this same SYSTEM_PROMPT/
// SCHEMA/error-classification but is NOT just extractLoadFromText fed OCR
// text — Anthropic's vision input is a separate message content-block shape
// (base64 image block, not a text block), so it's its own function rather
// than a text-extraction step bolted in front of the existing one.
import Anthropic from '@anthropic-ai/sdk'
import { logError, logEvent, type LogContext } from '@/lib/observability'

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

export class ExtractionFailedError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
  }
}

// `logContext` is whatever the caller has to identify itself in
// logs/observability — a userId for the authenticated route, an org id/
// intake address for the email webhook (which has no user session).
export async function extractLoadFromText(
  text: string,
  logContext: LogContext
): Promise<Record<string, unknown>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ExtractionFailedError('ANTHROPIC_API_KEY not configured', 500)
  }

  let message: Anthropic.Message
  try {
    message = await client.messages.create({
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
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? err.status : undefined
    const failureMode =
      status === 429 ? 'rate_limited' :
      status === 401 || status === 403 ? 'auth_error' :
      status && status >= 500 ? 'provider_outage' :
      'unknown'
    logError(logContext, err, { failure_mode: failureMode, status })
    throw new ExtractionFailedError('Extraction failed. Please try again shortly.', 502)
  }

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

  try {
    const extracted = JSON.parse(cleaned)
    logEvent(logContext, {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
    })
    return extracted
  } catch (err) {
    logError(logContext, err, {
      failure_mode: 'malformed_model_output',
      raw_response_length: raw.length,
    })
    throw new ExtractionFailedError('Extraction failed. Check your API key and try again.', 500)
  }
}

const SUPPORTED_IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
type SupportedImageMediaType = (typeof SUPPORTED_IMAGE_MEDIA_TYPES)[number]

export function isSupportedImageMediaType(mediaType: string): mediaType is SupportedImageMediaType {
  return (SUPPORTED_IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType)
}

// Mobile's photo-intake path (driver/dispatcher photographs a rate
// confirmation or BOL) — same prompt/schema/failure classification as
// extractLoadFromText above, but sent as a vision content block instead of
// plain text.
export async function extractLoadFromImage(
  base64Image: string,
  mediaType: SupportedImageMediaType,
  logContext: LogContext
): Promise<Record<string, unknown>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ExtractionFailedError('ANTHROPIC_API_KEY not configured', 500)
  }

  let message: Anthropic.Message
  try {
    message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
            { type: 'text', text: `Extract load data from this photo of a rate confirmation or BOL. Return JSON matching this schema:\n${SCHEMA}` },
          ],
        },
      ],
    })
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? err.status : undefined
    const failureMode =
      status === 429 ? 'rate_limited' :
      status === 401 || status === 403 ? 'auth_error' :
      status && status >= 500 ? 'provider_outage' :
      'unknown'
    logError(logContext, err, { failure_mode: failureMode, status })
    throw new ExtractionFailedError('Extraction failed. Please try again shortly.', 502)
  }

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

  try {
    const extracted = JSON.parse(cleaned)
    logEvent(logContext, {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
    })
    return extracted
  } catch (err) {
    logError(logContext, err, {
      failure_mode: 'malformed_model_output',
      raw_response_length: raw.length,
    })
    throw new ExtractionFailedError('Extraction failed. Check your API key and try again.', 500)
  }
}
