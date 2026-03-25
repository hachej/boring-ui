/**
 * tRPC context — provides authenticated user and services to procedures.
 * Stub — implementation in Phase 1 (bd-rwy92.4).
 */

export interface TRPCContext {
  userId?: string
  email?: string
  workspaceId?: string
}

export function createContext(): TRPCContext {
  throw new Error('Not implemented — see bd-rwy92.4: Auth system port')
}
