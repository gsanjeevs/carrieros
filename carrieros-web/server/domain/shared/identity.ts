// server/domain/shared/identity.ts
// The verified caller context that every application service is given.
//
// The single most important rule in this file: nothing here is ever built from
// client-supplied input. `tenantId`, `organizationId`, `relationshipId` and the
// rest are derived server-side from a verified Supabase JWT plus membership
// data read from the database. A request body that names a tenant is a *claim*,
// and claims are checked against this context — never used in its place.
//
// That distinction is the whole reason this type exists rather than passing
// loose ids around: a function that takes `(tenantId: string)` cannot tell
// whether its caller verified that id, whereas one that takes `ActorContext`
// can only be called with something the context factory produced.

/** Branded ids — prevents passing an org id where a user id is expected. */
export type UserId = string & { readonly __brand: 'UserId' }
export type OrgId = number & { readonly __brand: 'OrgId' }
export type RelationshipId = number & { readonly __brand: 'RelationshipId' }
export type CorrelationId = string & { readonly __brand: 'CorrelationId' }

export const asUserId = (v: string): UserId => v as UserId
export const asOrgId = (v: number): OrgId => v as OrgId
export const asRelationshipId = (v: number): RelationshipId => v as RelationshipId
export const asCorrelationId = (v: string): CorrelationId => v as CorrelationId

/**
 * Roles as they exist in `profiles.role` today. Kept as a domain concept so
 * policy code reads in business terms; the mapping from the database's TEXT
 * column lives in the infrastructure layer.
 *
 * `sx_*` are ShipmentX platform-operator roles, not carrier tenant roles —
 * they must never be treated as membership of the tenant they are acting on.
 */
export type ActorRole =
  | 'owner'
  | 'solo'
  | 'driver'
  | 'dispatcher'
  | 'finance'
  | 'customer_admin'
  | 'customer_viewer'
  | 'sx_owner'
  | 'sx_finance'
  | 'sx_support'

export const PLATFORM_ROLES: readonly ActorRole[] = ['sx_owner', 'sx_finance', 'sx_support']
export const isPlatformRole = (r: ActorRole) => PLATFORM_ROLES.includes(r)

/**
 * A caller whose identity AND tenant membership have both been verified.
 *
 * Construct only via the context factory in the infrastructure layer. There is
 * deliberately no public constructor taking raw ids.
 */
export interface ActorContext {
  readonly userId: UserId
  /**
   * The organization the actor belongs to, read from their own profile row —
   * never from the request.
   */
  readonly orgId: OrgId
  readonly role: ActorRole
  /**
   * True when the actor is ShipmentX platform staff acting through an
   * administrative surface. Platform staff bypass tenant membership but are
   * subject to their own, narrower policy checks and are always audited.
   */
  readonly isPlatformOperator: boolean
  /**
   * Correlates every log line, audit row and outbox event produced while
   * handling one request. Supplied by the client or minted at the edge.
   */
  readonly correlationId: CorrelationId
}

/**
 * An actor plus the specific counterparty relationship they are acting within.
 * Required for any operation that crosses a carrier↔shipper boundary, so the
 * relationship is proven once at the edge rather than re-derived (and possibly
 * re-derived wrongly) inside each service.
 */
export interface RelationshipContext extends ActorContext {
  readonly relationshipId: RelationshipId
  readonly counterpartyOrgId: OrgId
}
