// Host-owned bearer token check for the AWS recipe: RS256 JWTs signed by the configured OIDC issuer (Cognito or another
// one), verified against its JWKS with node:crypto. AgentCore's own JWT authorizer checks the same token before the
// container sees it; the container checks again because it also runs as a plain ECS service behind a load balancer, and
// because the identity it derives (`sub`) selects the user's folder. Tests use a fictional key pair and issuer.
import { createPublicKey, verify } from 'node:crypto';

const decode = part => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * @param {{ issuer: string, audience: string, jwks?: { keys: object[] }, jwksUrl?: string, fetch?: typeof fetch, now?: () => number, skewSeconds?: number }} options
 * @returns {(token: string) => Promise<Record<string, unknown> | null>} the verified claims, or null
 */
export function createJwtVerifier({ issuer, audience, jwks, jwksUrl, fetch: fetcher = fetch, now = () => Date.now(), skewSeconds = 60 }) {
  if (!issuer || !audience || (!jwks && !jwksUrl)) throw new TypeError('issuer, audience and a JWKS (keys or URL) are required');
  if (jwksUrl && new URL(jwksUrl).protocol !== 'https:') throw new TypeError('The JWKS URL must be https');
  let keys = jwks?.keys ?? [], fetchedAt = 0;
  async function keyFor(kid) {
    let found = keys.find(key => key.kid === kid);
    // An unknown key id refreshes the JWKS (key rotation), at most once a minute.
    if (!found && jwksUrl && now() - fetchedAt > 60_000) {
      fetchedAt = now();
      const response = await fetcher(jwksUrl, { redirect: 'error' });
      if (response.ok) keys = (await response.json()).keys ?? [];
      found = keys.find(key => key.kid === kid);
    }
    return found;
  }
  return async token => {
    try {
      const parts = String(token).split('.');
      if (parts.length !== 3) return null;
      const header = decode(parts[0]), claims = decode(parts[1]);
      if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
      const jwk = await keyFor(header.kid);
      if (!jwk || jwk.kty !== 'RSA' || (jwk.use && jwk.use !== 'sig')) return null;
      const signed = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
      if (!signed) return null;
      const seconds = now() / 1000;
      if (claims.iss !== issuer || typeof claims.exp !== 'number' || claims.exp + skewSeconds < seconds) return null;
      if (typeof claims.nbf === 'number' && claims.nbf - skewSeconds > seconds) return null;
      // ID tokens carry `aud`; Cognito access tokens carry `client_id` instead.
      const audiences = [claims.aud, claims.client_id].flat().filter(value => typeof value === 'string');
      if (!audiences.includes(audience)) return null;
      return claims;
    } catch { return null; }
  };
}
