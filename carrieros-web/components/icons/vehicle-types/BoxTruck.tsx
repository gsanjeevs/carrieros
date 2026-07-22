// components/icons/vehicle-types/BoxTruck.tsx
// Box truck: short cab + tall single-body cargo box, no articulation gap.
export default function BoxTruck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1.5 16V11a1 1 0 0 1 1-1h4.5V6.5a1 1 0 0 1 1-1H21a1 1 0 0 1 1 1V16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7 10v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M1.5 16h21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2.5 12.5h3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="5" cy="17.5" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17.5" cy="17.5" r="1.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
