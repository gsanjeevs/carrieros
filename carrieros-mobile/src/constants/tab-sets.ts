// src/constants/tab-sets.ts
// Single source of truth for the per-role tab sets, shared by the native
// tab bar (src/components/app-tabs.tsx, using expo-router's NativeTabs) and
// the web-preview tab bar (src/components/app-tabs.web.tsx, using
// expo-router/ui's Tabs — NativeTabs has no web renderer). Keeping the
// role -> screens mapping in one place means the two implementations can't
// silently drift apart.
//
// Order matters: the first entry is each role's default/initial tab.
//   Owner / Solo : Home, Loads, Alerts, Fleet, More
//   Dispatcher   : Home, Loads, Alerts, Fleet, Customers
//   Finance      : Home, Invoices, Customers, Reports, More
//   Driver       : My Load, DVIR, History, Profile
//
// Tab visibility is derived from the generated `ROLE_CAPABILITIES` (see
// src/lib/generated/role-capabilities.ts, sourced from the
// `role_capabilities` Postgres table / supabase/migrations/0009_role_capabilities.sql)
// wherever a tab maps cleanly 1:1 onto a capability, so this file and web's
// proxy.ts can't independently drift the way BILLING_ROLES once did.
//
// Not every tab maps cleanly onto a single capability — see the per-tab
// notes below. Those are still hand-gated by role and were deliberately
// NOT migrated; changing them was out of scope (see project audit).
import type { Role } from '@/hooks/use-profile-role';
import { roleHasCapability } from '@/lib/generated/role-capabilities';

// `name` is the file basename under src/app/(tabs)/ — a fixed, larger set
// of screens exists there than any single role links to.
export type TabSetEntry = { name: string; labelKey: string };

const HOME: TabSetEntry = { name: 'home', labelKey: 'tabs.home' };
const LOADS: TabSetEntry = { name: 'loads', labelKey: 'tabs.loads' };
const ALERTS: TabSetEntry = { name: 'alerts', labelKey: 'tabs.alerts' };
const FLEET: TabSetEntry = { name: 'fleet', labelKey: 'tabs.fleet' };
const CUSTOMERS: TabSetEntry = { name: 'customers', labelKey: 'tabs.customers' };
const MORE: TabSetEntry = { name: 'more', labelKey: 'tabs.more' };
const MY_LOAD: TabSetEntry = { name: 'my-load', labelKey: 'tabs.myLoad' };
const DVIR: TabSetEntry = { name: 'dvir-start', labelKey: 'tabs.dvir' };
const HISTORY: TabSetEntry = { name: 'history', labelKey: 'tabs.history' };
const PROFILE: TabSetEntry = { name: 'profile', labelKey: 'tabs.profile' };
const INVOICES: TabSetEntry = { name: 'invoices', labelKey: 'tabs.invoices' };
const REPORTS: TabSetEntry = { name: 'reports', labelKey: 'tabs.reports' };

// LOADS/ALERTS both track exactly the roles with the `dispatch` capability
// (owner, solo, dispatcher) today, and FLEET tracks `drivers` (same three
// roles). Deriving them from roleHasCapability() means a future
// role_capabilities change automatically flows through instead of needing
// a second hand-edit here.
function dispatchTabs(role: Role): TabSetEntry[] {
  return roleHasCapability(role, 'dispatch') ? [LOADS, ALERTS] : [];
}
function fleetTabs(role: Role): TabSetEntry[] {
  return roleHasCapability(role, 'drivers') ? [FLEET] : [];
}

export const TAB_SETS: Record<Role, TabSetEntry[]> = {
  // HOME is NOT gated on the `dashboard` capability even though every role
  // (including driver) has `dashboard` — driver's home-equivalent screen is
  // MY_LOAD, not HOME, so a capability-driven check would incorrectly add a
  // Home tab for drivers. Left as an explicit per-role literal.
  owner: [HOME, ...dispatchTabs('owner'), ...fleetTabs('owner'), MORE],
  solo: [HOME, ...dispatchTabs('solo'), ...fleetTabs('solo'), MORE],
  dispatcher: [HOME, ...dispatchTabs('dispatcher'), ...fleetTabs('dispatcher'), CUSTOMERS],
  // CUSTOMERS (dispatcher + finance only) has no matching generated
  // capability — no `customers` capability exists, and its role set
  // ({dispatcher, finance}) doesn't equal any single capability's holder
  // set. MORE (owner/solo/finance) coincidentally has the same holder set
  // as the `finance` capability, but that's not a semantic match (MORE is
  // a catch-all menu, not finance-gated) — tying it to `finance` would be
  // fragile, so both are left hardcoded per role.
  // INVOICES/REPORTS (finance only) and MY_LOAD/DVIR/HISTORY/PROFILE
  // (driver only) are likewise left hardcoded: `invoice_actions` and
  // `my_loads` are also held by owner/solo, who don't get these top-level
  // tabs (they reach the equivalent screens via MORE instead), so gating
  // on the capability alone would wrongly add these tabs for owner/solo.
  // `reports`/dvir/history/profile have no corresponding capability at all.
  finance: [HOME, INVOICES, CUSTOMERS, REPORTS, MORE],
  driver: [MY_LOAD, DVIR, HISTORY, PROFILE],
};
