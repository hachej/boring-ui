export {
  createFakeAuthorityVerifierV1,
  createHostSideCredentialResolverV1,
  createInMemoryCredentialBackendV1,
} from './hostResolver'
export type {
  CredentialStoreBackendV1,
  FakeAuthorityVerifierGrantV1,
  HostSideCredentialResolverOptionsV1,
  InMemoryCredentialBackendEntryV1,
} from './hostResolver'
export { withResolvedCredential } from './withResolvedCredential'
