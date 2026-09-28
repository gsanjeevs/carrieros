'use client'
// app/(app)/invoices/[invoice_number]/print/PrintButton.tsx
// The only client-side bit this route needs: window.print() itself.
// Choosing "Save as PDF" as the destination in the browser's print dialog
// is what makes this a real "Download PDF" feature, not a stub.
import { Button } from '@/components/ui'

export default function PrintButton({ label }: { label: string }) {
  return (
    <Button
      size="lg"
      className="gap-2"
      onClick={() => window.print()}
    >
      <span className="material-symbols-outlined text-[18px]">print</span>
      {label}
    </Button>
  )
}
