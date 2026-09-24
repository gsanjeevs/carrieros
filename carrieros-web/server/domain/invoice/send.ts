export interface InvoiceEmailInput {
  readonly invoiceId: number
  readonly invoiceNumber: string
  readonly amount: number
  readonly dueDate: string | null
  readonly customerName: string | null
  readonly loadTrackingToken: string | null
}

export function buildInvoiceEmail(input: InvoiceEmailInput, appUrl: string) {
  const trackingLink = input.loadTrackingToken ? `${appUrl}/track/${input.loadTrackingToken}` : null
  const trackingPixel = `<img src="${appUrl}/api/invoices/${input.invoiceId}/track" width="1" height="1" alt="" style="display:none" />`
  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(input.amount)

  return {
    subject: `Invoice ${input.invoiceNumber}`,
    html: `
      <p>Hello${input.customerName ? ` ${input.customerName}` : ''},</p>
      <p>Invoice <strong>${input.invoiceNumber}</strong> for
      <strong>${amount}</strong> is now due${input.dueDate ? ` by ${input.dueDate}` : ''}.</p>
      ${trackingLink ? `<p><a href="${trackingLink}">Track this shipment</a></p>` : ''}
      <p>— CarrierOS</p>
      ${trackingPixel}
    `.trim(),
  }
}
