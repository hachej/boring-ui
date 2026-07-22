import type { WrappedWorkspaceDekV1 } from './kek'

export const CREDENTIAL_ENVELOPE_VERSION =
  'boring.credential-envelope.v1' as const

/** Logical field envelope. Storage may normalize wrappedDek into a key row. */
export interface CredentialEnvelopeV1 {
  readonly envelopeVersion: typeof CREDENTIAL_ENVELOPE_VERSION
  readonly wrappedDek: WrappedWorkspaceDekV1
  readonly ciphertext: Uint8Array
  readonly nonce: Uint8Array
  readonly authTag: Uint8Array
  readonly aadContext: Uint8Array
}
