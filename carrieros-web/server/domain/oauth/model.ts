// server/domain/oauth/model.ts
// Read shape for the public developer API's OAuth clients (Settings UI list).
// The secret is never part of this type — it exists only transiently, at
// creation, as the plain string returned once by OAuthClientService.create().

export interface OAuthClientSummary {
  readonly id: number
  readonly clientId: string
  readonly name: string
  readonly createdAt: string
  readonly lastUsedAt: string | null
  readonly revokedAt: string | null
}
