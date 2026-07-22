import type { WrappedWorkspaceDekV1 } from '../../shared/credentials'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../shared/credentials'

const MAX_WRAPPED_BYTES_V1 = 65_536
const MAX_EXTERNAL_OPAQUE_BYTES_V1 = 64_512
const MAX_WRAPPER_AAD_BYTES_V1 = 4_096

function unreadable(): CredentialResolutionError {
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.UNREADABLE,
    'Wrapped workspace key is unreadable',
  )
}

function validBytes(
  value: unknown,
  minimum: number,
  maximum: number,
): value is Uint8Array {
  return value instanceof Uint8Array
    && value.byteLength >= minimum
    && value.byteLength <= maximum
}

function isAllZero(bytes: Uint8Array): boolean {
  let aggregate = 0
  for (const byte of bytes) aggregate |= byte
  return aggregate === 0
}

/** Canonical fail-closed shape validation shared by selectors and persistence. */
export function assertWrappedWorkspaceDekV1(
  wrapped: WrappedWorkspaceDekV1,
): void {
  if (
    !wrapped
    || typeof wrapped.providerId !== 'string'
    || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(wrapped.providerId)
    || typeof wrapped.keyRef !== 'string'
    || wrapped.keyRef.length === 0
    || Buffer.byteLength(wrapped.keyRef, 'utf8') > 512
    || /[\u0000-\u001f\u007f]/.test(wrapped.keyRef)
    || !Number.isSafeInteger(wrapped.keyVersion)
    || wrapped.keyVersion <= 0
    || !wrapped.payload
  ) {
    throw unreadable()
  }

  if (wrapped.payload.format === 'vault-transit-ciphertext.v1') {
    if (!validBytes(wrapped.payload.ciphertext, 1, MAX_WRAPPED_BYTES_V1)) {
      throw unreadable()
    }
    return
  }

  if (wrapped.payload.format === 'local-aes-256-gcm.v1') {
    if (
      !validBytes(wrapped.payload.ciphertext, 32, 32)
      || !validBytes(wrapped.payload.nonce, 12, 12)
      || isAllZero(wrapped.payload.nonce)
      || !validBytes(wrapped.payload.authTag, 16, 16)
      || !validBytes(wrapped.payload.aadContext, 1, MAX_WRAPPER_AAD_BYTES_V1)
    ) {
      throw unreadable()
    }
    return
  }

  if (wrapped.payload.format === 'external-kms-opaque.v1') {
    if (
      typeof wrapped.payload.payloadFormatId !== 'string'
      || !/^[a-z0-9][a-z0-9._-]{0,255}$/.test(
        wrapped.payload.payloadFormatId,
      )
      || !validBytes(
        wrapped.payload.opaqueAuthenticatedPayload,
        1,
        MAX_EXTERNAL_OPAQUE_BYTES_V1,
      )
    ) {
      throw unreadable()
    }
    return
  }

  throw unreadable()
}
