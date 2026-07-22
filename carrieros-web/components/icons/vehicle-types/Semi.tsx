// components/icons/vehicle-types/Semi.tsx
// Semi (tractor-trailer): cab + long rectangular trailer, articulation gap.
export default function Semi({ className }: { className?: string }) {
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
        d="M9 15.5V6h11.5a1 1 0 0 1 1 1v8.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M1.5 15.5h21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8.5 11h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="4.5" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12.5" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18.5" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
