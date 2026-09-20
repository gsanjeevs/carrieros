// lib/send-email.ts
// Thin wrapper around a real SMTP send. Server-side only.
//
// Local dev: falls back to the Mailpit/Inbucket instance that
// `supabase start` already runs for auth emails (see supabase/config.toml
// [local_smtp] — smtp_port is uncommented there to publish it to the host
// at 127.0.0.1:54325). No credentials needed locally; nothing actually
// leaves the machine, and sent mail can be inspected at
// http://127.0.0.1:54324.
//
// Production: set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM (e.g.
// to Resend's SMTP endpoint) — this file does not change, only env vars do.

import nodemailer from 'nodemailer'
import { logError } from '@/lib/observability'

const DEFAULT_SMTP_HOST = '127.0.0.1'
const DEFAULT_SMTP_PORT = 54325
const DEFAULT_SMTP_FROM = 'CarrierOS <no-reply@carrieros.local>'

export interface SendEmailAttachment {
  filename: string
  content: Buffer
  contentType?: string
}

export interface SendEmailArgs {
  to: string
  subject: string
  html: string
  attachments?: SendEmailAttachment[]
}

export interface SendEmailResult {
  ok: boolean
  error?: string
}

export async function sendEmail({ to, subject, html, attachments }: SendEmailArgs): Promise<SendEmailResult> {
  const host = process.env.SMTP_HOST || DEFAULT_SMTP_HOST
  const port = Number(process.env.SMTP_PORT || DEFAULT_SMTP_PORT)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM || DEFAULT_SMTP_FROM

  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      // Local Mailpit/Inbucket has no TLS and no auth. Real providers
      // (Resend etc.) typically want STARTTLS on 587 — nodemailer infers
      // secure:false + STARTTLS for anything other than port 465.
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    })

    await transport.sendMail({ from, to, subject, html, attachments })
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown SMTP error'
    logError({ route: 'send-email' }, message, { step: 'SMTP send failed' })
    return { ok: false, error: message }
  }
}
