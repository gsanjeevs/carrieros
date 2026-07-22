// components/icons/maintenance/BrakeService.tsx
// Brake disc (rotor + vents) with a caliper — used for "Brake Service"
// reminders/logs.
export default function BrakeService({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="11" cy="12" r="7.2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11" cy="6.8" r="0.7" fill="currentColor" />
      <circle cx="15.2" cy="9.4" r="0.7" fill="currentColor" />
      <circle cx="15.2" cy="14.6" r="0.7" fill="currentColor" />
      <circle cx="11" cy="17.2" r="0.7" fill="currentColor" />
      <circle cx="6.8" cy="14.6" r="0.7" fill="currentColor" />
      <circle cx="6.8" cy="9.4" r="0.7" fill="currentColor" />
      <path
        d="M17.5 8.5h2.3a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2.3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}
