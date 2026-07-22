// components/icons/vehicle-types/StepDeck.tsx
// Step deck: cab + a visible two-level open-deck profile (upper deck over
// the gooseneck, then a step down to a longer, lower rear deck).
export default function StepDeck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1.5 15.5V10a1 1 0 0 1 1-1h2.8l1.8-3h1.9v3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 9.5h3.5V12H21a1 1 0 0 1 1 1v2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M1.5 15.5h21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="4.5" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="14.5" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="19.5" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
