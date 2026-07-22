// components/icons/maintenance/OilChange.tsx
// Oil drop inside a can-like outline — used for "Oil Change" reminders/logs.
export default function OilChange({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 3.5c2.4 3 4 5.6 4 7.8a4 4 0 1 1-8 0c0-2.2 1.6-4.8 4-7.8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 8.5c-.9 1.3-1.4 2.3-1.4 3.1a1.4 1.4 0 1 0 2.8 0"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 20.5h14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
