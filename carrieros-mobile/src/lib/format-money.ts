// src/lib/format-money.ts
// Mirrors carrieros-web/lib/format-money.ts's role (a shared formatter
// rather than each screen hand-rolling `$${n.toFixed(2)}`), scoped to USD
// for now -- no multi-currency call site exists in mobile yet, unlike web's
// version which already threads a `currency` param through from
// carrier_details.
export function formatMoney(amount: number): string {
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
