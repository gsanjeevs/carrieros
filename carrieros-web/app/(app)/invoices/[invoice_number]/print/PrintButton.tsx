'use client'
// app/(app)/invoices/[invoice_number]/print/PrintButton.tsx
// The only client-side bit this route needs: window.print() itself.
// Choosing "Save as PDF" as the destination in the browser's print dialog
// is what makes this a real "Download PDF" feature, not a stub.

export default function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white text-sm font-semibold rounded-lg transition"
    >
      <span className="material-symbols-outlined text-[18px]">print</span>
      {label}
    </button>
  )
}
