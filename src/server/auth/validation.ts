/**
 * Token validation — JWKS-based JWT verification for Neon Auth tokens.
 * Stub — implementation in Phase 1 (bd-rwy92.4).
 */

export interface TokenValidationResult {
  valid: boolean
  userId?: string
  email?: string
  error?: string
}

export async function validateEdDSAToken(
  _token: string,
  _jwksUrl: string,
  _audience?: string,
): Promise<TokenValidationResult> {
  throw new Error('Not implemented — see bd-rwy92.4')
}
