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
import type { Role } from '@/hooks/use-profile-role';

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

export const TAB_SETS: Record<Role, TabSetEntry[]> = {
  owner: [HOME, LOADS, ALERTS, FLEET, MORE],
  solo: [HOME, LOADS, ALERTS, FLEET, MORE],
  dispatcher: [HOME, LOADS, ALERTS, FLEET, CUSTOMERS],
  finance: [HOME, INVOICES, CUSTOMERS, REPORTS, MORE],
  driver: [MY_LOAD, DVIR, HISTORY, PROFILE],
};
