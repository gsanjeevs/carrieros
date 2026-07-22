// components/icons/maintenance/DotInspection.tsx
// Clipboard with a checkmark — used for "DOT Inspection" reminders/logs.
export default function DotInspection({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="5.5" y="4" width="13" height="17" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9 4.2a3 3 0 0 1 6 0"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect x="9" y="3" width="6" height="2.6" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M8.5 12.5l2 2 4-4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 17h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
