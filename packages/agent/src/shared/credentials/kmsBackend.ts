/**
 * Ratified `KmsBackend` abstraction (docs/issues/820/byok-secret-vault-plan.md,
 * "KmsBackend interface (pluggable KEK provider)", amendment A).
 *
 * This module is intentionally backend-agnostic: OVH KMS, Scaleway Key Manager,
 * Exoscale KMS, self-run Vault/OpenBao Transit and the local-KEK envelope are
 * all implementations of `WorkspaceKekProviderV1`. Only the KEK-holder call
 * differs; the per-workspace DEK and the AAD-bound AES-256-GCM field crypto are
 * identical across every backend.
 *
 * Shared code stays `Uint8Array`-only: no `node:*` import and no Node byte-array
 * type may appear here. Backend-specific crypto lives under `src/server/**`.
 */

export const WORKSPACE_KEK_PROVIDER_VERSION =
  "boring.workspace-kek-provider.v1" as const

export const CREDENTIAL_ENVELOPE_VERSION =
  "boring.credential-envelope.v1" as const

/** Canonical AAD encoding version; changing it is a migration, not a tweak. */
export const CREDENTIAL_AAD_ENCODING_VERSION =
  "boring.credential-aad.v1" as const

/** AES-256-GCM parameters. Fixed by the ratified design; never widened. */
export const CREDENTIAL_DEK_BYTE_LENGTH_V1 = 32
export const CREDENTIAL_KEK_BYTE_LENGTH_V1 = 32
export const CREDENTIAL_NONCE_BYTE_LENGTH_V1 = 12
export const CREDENTIAL_AUTH_TAG_BYTE_LENGTH_V1 = 16

export interface WorkspaceKekContextV1 {
  readonly workspaceId: string
  readonly dekGeneration: number
  readonly requestId: string
}

export type WrappedWorkspaceDekPayloadV1 =
  | Readonly<{
      /** Reserved for a future self-run Vault/OpenBao Transit backend. */
      format: "vault-transit-ciphertext.v1"
      ciphertext: Uint8Array
    }>
  | Readonly<{
      format: "local-aes-256-gcm.v1"
      ciphertext: Uint8Array
      nonce: Uint8Array
      authTag: Uint8Array
      aadContext: Uint8Array
    }>
  | Readonly<{
      /** Reserved. A future backend must define and conformance-test this. */
      format: "external-kms-opaque.v1"
      payloadFormatId: string
      opaqueAuthenticatedPayload: Uint8Array
    }>

export interface WrappedWorkspaceDekV1 {
  readonly providerId: string
  readonly keyRef: string
  readonly keyVersion: number
  readonly payload: WrappedWorkspaceDekPayloadV1
}

export interface GeneratedWorkspaceDekV1 {
  /** Transient plaintext; the caller overwrites and drops it in `finally`. */
  readonly plaintextDek: Uint8Array
  readonly wrappedDek: WrappedWorkspaceDekV1
}

export interface WorkspaceKekProviderReadinessV1 {
  readonly ready: boolean
  readonly reasonCode?: string
}

/**
 * `readiness()` returning `ready: false`, or any backend/KEK error, denies the
 * credential operation (fail closed). An implementation never falls back to
 * another backend or to plaintext.
 */
export interface WorkspaceKekProviderV1 {
  readonly contractVersion: typeof WORKSPACE_KEK_PROVIDER_VERSION
  readonly providerId: string
  generateDataKey(
    context: WorkspaceKekContextV1,
  ): Promise<GeneratedWorkspaceDekV1>
  unwrapDataKey(
    context: WorkspaceKekContextV1,
    wrapped: WrappedWorkspaceDekV1,
  ): Promise<Uint8Array>
  rewrapDataKey?(
    context: WorkspaceKekContextV1,
    wrapped: WrappedWorkspaceDekV1,
  ): Promise<WrappedWorkspaceDekV1>
  readiness(): Promise<WorkspaceKekProviderReadinessV1>
  close?(): Promise<void>
}

/**
 * The identity a field envelope is cryptographically bound to. Every component
 * is part of the AAD, so moving a row between workspaces, providers, fields,
 * credential versions or DEK generations fails authentication.
 */
export interface CredentialFieldAadContextV1 {
  readonly workspaceId: string
  readonly credentialId: string
  readonly providerId: string
  readonly fieldId: string
  readonly credentialVersion: number
  readonly dekGeneration: number
}

/** Logical encrypted field envelope; the DB may normalize `wrappedDek` away. */
export interface CredentialEnvelopeV1 {
  readonly envelopeVersion: typeof CREDENTIAL_ENVELOPE_VERSION
  readonly ciphertext: Uint8Array
  readonly nonce: Uint8Array
  readonly authTag: Uint8Array
  readonly aadContext: Uint8Array
}
