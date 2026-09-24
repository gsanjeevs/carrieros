// server/infrastructure/email/smtp-email-gateway.ts
// Thin adapter over lib/send-email.ts's real SMTP send for the EmailGateway
// port. Kept out of server/application (dependency-free per Rule D) and out
// of server/domain (pure, no I/O).
import { sendEmail } from '@/lib/send-email'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { EmailGateway } from '../../ports'

export class SmtpEmailGateway implements EmailGateway {
  async send(input: { readonly to: string; readonly subject: string; readonly html: string }): Promise<Result<void>> {
    const result = await sendEmail(input)
    if (!result.ok) return err(domainError('EMAIL_SEND_FAILED', result.error ?? 'Unknown SMTP error'))
    return ok(undefined)
  }
}
