/**
 * Neon Auth client — server-to-server communication with Neon Auth.
 * Stub — implementation in Phase 1 (bd-rwy92.4).
 */

export interface NeonAuthClient {
  signIn(email: string, password: string): Promise<{ token: string }>
  signUp(email: string, password: string, name?: string): Promise<{ userId: string }>
  verifyToken(token: string): Promise<{ userId: string; email: string }>
}

export function createNeonAuthClient(_baseUrl: string): NeonAuthClient {
  throw new Error('Not implemented — see bd-rwy92.4')
}
