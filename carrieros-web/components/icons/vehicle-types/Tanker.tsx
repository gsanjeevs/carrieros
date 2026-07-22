// components/icons/vehicle-types/Tanker.tsx
// Tanker: cab + cylindrical tank trailer (rounded ends, horizontal band).
export default function Tanker({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1.5 15.5V10a1 1 0 0 1 1-1h2.7l1.6-2.5h1.7v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="9" y="7" width="12.5" height="7" rx="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.3 7v7M16 7v7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M1.5 15.5h21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="4.5" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13.5" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18.5" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
