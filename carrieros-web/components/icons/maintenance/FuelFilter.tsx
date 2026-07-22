// components/icons/maintenance/FuelFilter.tsx
// Funnel/filter shape with a drop — used for "Fuel Filter" reminders/logs.
export default function FuelFilter({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5 5h14l-5.5 6.8v5.4l-3 1.8v-7.2L5 5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8.2 8h7.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M18.5 15.2c.9 1.1 1.3 1.9 1.3 2.6a1.3 1.3 0 1 1-2.6 0c0-.7.4-1.5 1.3-2.6Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}
