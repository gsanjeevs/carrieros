// server/infrastructure/crypto/oauth-credentials.ts
// The only place bcrypt and Node's CSPRNG are imported for the public API.
// Kept out of server/application (which stays dependency-free per Rule D)
// and out of server/domain (pure, no I/O) — this is the infrastructure
// adapter for the OAuthCredentialProvider port.
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { OAuthCredentialProvider } from '../../ports'

// Cost 12 is bcryptjs's own recommended floor for new secrets in 2026; unlike a
// user password this compares on every API call, so it also bounds request latency.
const BCRYPT_COST = 12

export class NodeOAuthCredentialProvider implements OAuthCredentialProvider {
  newClientId(): string {
    return `pub_client_${randomBytes(16).toString('hex')}`
  }

  newClientSecret(): string {
    return `pub_secret_${randomBytes(32).toString('base64url')}`
  }

  async hashSecret(secret: string): Promise<string> {
    return bcrypt.hash(secret, BCRYPT_COST)
  }

  // bcrypt.compare is itself constant-time over the hash comparison; there is no
  // separate string-equality step here that could leak timing information.
  async verifySecret(secret: string, hash: string): Promise<boolean> {
    return bcrypt.compare(secret, hash)
  }
}
