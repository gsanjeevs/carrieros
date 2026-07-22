// components/icons/maintenance/GenericService.tsx
// Wrench — fallback icon for any reminder_type/service_type that doesn't
// match one of the five named maintenance icons.
export default function GenericService({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M15.5 4a4.5 4.5 0 0 0-5.9 5.1L4 14.7a2 2 0 0 0 2.8 2.8l5.6-5.6a4.5 4.5 0 0 0 5.1-5.9l-2.9 2.9-2.1-2.1L15.5 4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="5.6" cy="18.4" r="0.9" fill="currentColor" />
    </svg>
  )
}
