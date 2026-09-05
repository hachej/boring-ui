/**
 * Test-only credential helpers. Deliberately excluded from the package's
 * public `server/index.ts` and `credentials/index.ts` surfaces: a fake
 * authority verifier must never be reachable from production composition
 * paths. Import directly from this module in tests.
 */
export { createFakeAuthorityVerifierV1 } from './hostResolver'
export type { FakeAuthorityVerifierGrantV1 } from './hostResolver'
