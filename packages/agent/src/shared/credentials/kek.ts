export const WORKSPACE_KEK_PROVIDER_VERSION =
  'boring.workspace-kek-provider.v1' as const

export interface WorkspaceKekContextV1 {
  readonly workspaceId: string
  readonly dekGeneration: number
  readonly requestId: string
}

export type WrappedWorkspaceDekPayloadV1 =
  | Readonly<{
      format: 'vault-transit-ciphertext.v1'
      ciphertext: Uint8Array
    }>
  | Readonly<{
      format: 'local-aes-256-gcm.v1'
      ciphertext: Uint8Array
      nonce: Uint8Array
      authTag: Uint8Array
      aadContext: Uint8Array
    }>
  | Readonly<{
      format: 'external-kms-opaque.v1'
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
  readonly plaintextDek: Uint8Array
  readonly wrappedDek: WrappedWorkspaceDekV1
}

/** Ratified KmsBackend contract. Implementations must fail closed. */
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
  readiness(): Promise<Readonly<{ ready: boolean; reasonCode?: string }>>
  close?(): Promise<void>
}
