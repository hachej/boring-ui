import { assertWrappedWorkspaceDekV1 } from '@hachej/boring-agent/server'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '@hachej/boring-agent/shared'
import type { WrappedWorkspaceDekV1 } from '@hachej/boring-agent/shared'

const MAX_STORED_WRAPPER_BYTES_V1 = 65_536

export interface StoredCredentialKeyRowV1 {
  readonly workspaceId: string
  readonly dekGeneration: number
  readonly kekProviderId: string
  readonly keyRef: string
  readonly keyVersion: number
  readonly wrapperFormat: string
  readonly wrappedPayload: Uint8Array
  readonly wrapperNonce: Uint8Array | null
  readonly wrapperAuthTag: Uint8Array | null
  readonly wrapperAadContext: Uint8Array | null
  readonly state: string
}

function unreadable(): CredentialResolutionError {
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.UNREADABLE,
    'Credential vault material is unreadable',
  )
}

export function serializeCredentialWrappedDekV1(
  wrapped: WrappedWorkspaceDekV1,
): Readonly<{
  kekProviderId: string
  keyRef: string
  keyVersion: number
  wrapperFormat: string
  wrappedPayload: Uint8Array
  wrapperNonce: Uint8Array | null
  wrapperAuthTag: Uint8Array | null
  wrapperAadContext: Uint8Array | null
}> {
  assertWrappedWorkspaceDekV1(wrapped)
  const base = {
    kekProviderId: wrapped.providerId,
    keyRef: wrapped.keyRef,
    keyVersion: wrapped.keyVersion,
    wrapperFormat: wrapped.payload.format,
  }
  if (wrapped.payload.format === 'local-aes-256-gcm.v1') {
    return {
      ...base,
      wrappedPayload: wrapped.payload.ciphertext,
      wrapperNonce: wrapped.payload.nonce,
      wrapperAuthTag: wrapped.payload.authTag,
      wrapperAadContext: wrapped.payload.aadContext,
    }
  }
  if (wrapped.payload.format === 'vault-transit-ciphertext.v1') {
    return {
      ...base,
      wrappedPayload: wrapped.payload.ciphertext,
      wrapperNonce: null,
      wrapperAuthTag: null,
      wrapperAadContext: null,
    }
  }

  const formatPrefix = Buffer.from(
    `${wrapped.payload.payloadFormatId}\0`,
    'utf8',
  )
  if (
    formatPrefix.byteLength > 1_024
    || formatPrefix.byteLength
      + wrapped.payload.opaqueAuthenticatedPayload.byteLength
      > MAX_STORED_WRAPPER_BYTES_V1
  ) {
    throw unreadable()
  }
  return {
    ...base,
    wrappedPayload: new Uint8Array(Buffer.concat([
      formatPrefix,
      Buffer.from(wrapped.payload.opaqueAuthenticatedPayload),
    ])),
    wrapperNonce: null,
    wrapperAuthTag: null,
    wrapperAadContext: null,
  }
}

export function deserializeCredentialWrappedDekV1(
  row: StoredCredentialKeyRowV1,
): WrappedWorkspaceDekV1 {
  const base = {
    providerId: row.kekProviderId,
    keyRef: row.keyRef,
    keyVersion: row.keyVersion,
  }
  let wrapped: WrappedWorkspaceDekV1
  if (row.wrapperFormat === 'local-aes-256-gcm.v1') {
    if (!row.wrapperNonce || !row.wrapperAuthTag || !row.wrapperAadContext) {
      throw unreadable()
    }
    wrapped = {
      ...base,
      payload: {
        format: 'local-aes-256-gcm.v1',
        ciphertext: row.wrappedPayload,
        nonce: row.wrapperNonce,
        authTag: row.wrapperAuthTag,
        aadContext: row.wrapperAadContext,
      },
    }
  } else if (row.wrapperFormat === 'vault-transit-ciphertext.v1') {
    wrapped = {
      ...base,
      payload: {
        format: 'vault-transit-ciphertext.v1',
        ciphertext: row.wrappedPayload,
      },
    }
  } else if (row.wrapperFormat === 'external-kms-opaque.v1') {
    const separator = row.wrappedPayload.indexOf(0)
    if (separator <= 0 || separator > 1_024) throw unreadable()
    wrapped = {
      ...base,
      payload: {
        format: 'external-kms-opaque.v1',
        payloadFormatId: Buffer.from(
          row.wrappedPayload.subarray(0, separator),
        ).toString('utf8'),
        opaqueAuthenticatedPayload: row.wrappedPayload.subarray(separator + 1),
      },
    }
  } else {
    throw unreadable()
  }
  assertWrappedWorkspaceDekV1(wrapped)
  return wrapped
}
