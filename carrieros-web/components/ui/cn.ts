// Tiny local classnames combiner for components/ui/*.
// No external dependency (no clsx/tailwind-merge in package.json today) —
// just filters falsy values and joins. Not part of Core's component
// catalog; internal plumbing shared by every component in this folder.
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
