// components/icons/vehicle-types/Reefer.tsx
// Reefer: cab + trailer with rounded top corners (insulated look) and a
// front-mounted refrigeration unit block.
export default function Reefer({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1.5 15.5V9a1 1 0 0 1 1-1h2.7l1.8-3h2v6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 15.5V7.5A1.5 1.5 0 0 1 10.5 6h9A1.5 1.5 0 0 1 21 7.5v8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="9.5" y="7" width="2" height="5.5" rx="0.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.5 15.5h21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="4.5" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12.5" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18.5" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
