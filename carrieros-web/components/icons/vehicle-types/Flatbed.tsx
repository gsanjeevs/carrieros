// components/icons/vehicle-types/Flatbed.tsx
// Flatbed: cab + a flat open deck line (no enclosed cargo box), with a
// couple of strapped-cargo marks to read as "open deck" at a glance.
export default function Flatbed({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1.5 15.5V10a1 1 0 0 1 1-1h2.8l1.8-3h1.9v3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 9.5h12.5a1 1 0 0 1 1 1v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1.5 15.5h21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="10.5" y="6.5" width="4" height="3" rx="0.4" stroke="currentColor" strokeWidth="1.4" />
      <rect x="15.5" y="6.5" width="4" height="3" rx="0.4" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="4.5" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12.5" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18.5" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
