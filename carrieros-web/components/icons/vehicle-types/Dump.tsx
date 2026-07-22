// components/icons/vehicle-types/Dump.tsx
// Dump truck: cab + a raised, angled rear bed (front higher than back,
// hinge visible) — the "tipping bed" silhouette.
export default function Dump({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1.5 16V12a1 1 0 0 1 1-1h3.2l1.5-2.5h1.8V13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 13V8.5h9.5L21 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1.5 16h21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="5" cy="17.5" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13.5" cy="17.5" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18.5" cy="17.5" r="1.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
