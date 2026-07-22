// components/icons/maintenance/TireRotation.tsx
// Tire (circle + tread marks) with rotation arrows — used for "Tire
// Rotation" reminders/logs.
export default function TireRotation({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M12 8.2v-1.4M12 17.2v-1.4M8.2 12h-1.4M17.2 12h-1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path
        d="M17.5 6.5A9 9 0 0 1 20.5 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M20.5 12l-2.2-.6.9-2.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M6.5 17.5A9 9 0 0 1 3.5 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M3.5 12l2.2.6-.9 2.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
