import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'

import type {
  CredentialEnvelopeV1,
  WrappedWorkspaceDekV1,
} from '../../shared/credentials'
import {
  CREDENTIAL_ENVELOPE_VERSION,
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../shared/credentials'
import {
  constantTimeBytesEqualV1,
  encodeCanonicalTupleV1,
} from './canonicalEncoding'

const AES_256_KEY_BYTES_V1 = 32
const AES_GCM_NONCE_BYTES_V1 = 12
const AES_GCM_AUTH_TAG_BYTES_V1 = 16
const MAX_CREDENTIAL_FIELD_BYTES_V1 = 65_536
const CREDENTIAL_FIELD_AAD_DOMAIN_V1 = 1

export interface CredentialFieldAadContextV1 {
  readonly workspaceId: string
  readonly credentialId: string
  readonly providerId: string
  readonly fieldId: string
  readonly credentialVersion: number
  readonly dekGeneration: number
}

function unreadable(): CredentialResolutionError {
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.UNREADABLE,
    'Credential envelope is unreadable',
  )
}

function isAllZero(bytes: Uint8Array): boolean {
  let aggregate = 0
  for (const byte of bytes) aggregate |= byte
  return aggregate === 0
}

function assertDek(dek: Uint8Array): void {
  if (!(dek instanceof Uint8Array) || dek.byteLength !== AES_256_KEY_BYTES_V1) {
    throw unreadable()
  }
}

function assertEnvelopeShape(envelope: CredentialEnvelopeV1): void {
  if (
    !envelope
    || envelope.envelopeVersion !== CREDENTIAL_ENVELOPE_VERSION
    || !(envelope.ciphertext instanceof Uint8Array)
    || envelope.ciphertext.byteLength > MAX_CREDENTIAL_FIELD_BYTES_V1
    || !(envelope.nonce instanceof Uint8Array)
    || envelope.nonce.byteLength !== AES_GCM_NONCE_BYTES_V1
    || isAllZero(envelope.nonce)
    || !(envelope.authTag instanceof Uint8Array)
    || envelope.authTag.byteLength !== AES_GCM_AUTH_TAG_BYTES_V1
    || !(envelope.aadContext instanceof Uint8Array)
    || envelope.aadContext.byteLength === 0
  ) {
    throw unreadable()
  }
}

export function buildCredentialFieldAadV1(
  context: CredentialFieldAadContextV1,
): Uint8Array {
  try {
    return encodeCanonicalTupleV1(CREDENTIAL_FIELD_AAD_DOMAIN_V1, [
      context.workspaceId,
      context.credentialId,
      context.providerId,
      context.fieldId,
      context.credentialVersion,
      context.dekGeneration,
    ])
  } catch {
    throw unreadable()
  }
}

export function encryptField(
  plaintext: Uint8Array,
  dek: Uint8Array,
  wrappedDek: WrappedWorkspaceDekV1,
  context: CredentialFieldAadContextV1,
): CredentialEnvelopeV1 {
  if (
    !(plaintext instanceof Uint8Array)
    || plaintext.byteLength > MAX_CREDENTIAL_FIELD_BYTES_V1
  ) {
    throw unreadable()
  }
  assertDek(dek)
  let plaintextBuffer: Buffer | undefined
  let dekBuffer: Buffer | undefined
  let aad: Buffer | undefined
  let nonce: Buffer | undefined
  try {
    plaintextBuffer = Buffer.from(plaintext)
    dekBuffer = Buffer.from(dek)
    aad = Buffer.from(buildCredentialFieldAadV1(context))
    nonce = randomBytes(AES_GCM_NONCE_BYTES_V1)
    if (isAllZero(nonce)) throw unreadable()
    const cipher = createCipheriv('aes-256-gcm', dekBuffer, nonce, {
      authTagLength: AES_GCM_AUTH_TAG_BYTES_V1,
    })
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([
      cipher.update(plaintextBuffer),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()
    return {
      envelopeVersion: CREDENTIAL_ENVELOPE_VERSION,
      wrappedDek,
      ciphertext: new Uint8Array(ciphertext),
      nonce: new Uint8Array(nonce),
      authTag: new Uint8Array(authTag),
      aadContext: new Uint8Array(aad),
    }
  } catch (error) {
    if (error instanceof CredentialResolutionError) throw error
    throw unreadable()
  } finally {
    plaintextBuffer?.fill(0)
    dekBuffer?.fill(0)
    nonce?.fill(0)
    aad?.fill(0)
  }
}

export function decryptField(
  envelope: CredentialEnvelopeV1,
  dek: Uint8Array,
  context: CredentialFieldAadContextV1,
): Uint8Array {
  assertDek(dek)
  assertEnvelopeShape(envelope)
  let dekBuffer: Buffer | undefined
  let expectedAad: Buffer | undefined
  let persistedAad: Buffer | undefined
  let plaintext: Buffer | undefined
  try {
    dekBuffer = Buffer.from(dek)
    expectedAad = Buffer.from(buildCredentialFieldAadV1(context))
    persistedAad = Buffer.from(envelope.aadContext)
    if (!constantTimeBytesEqualV1(persistedAad, expectedAad)) {
      throw unreadable()
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      dekBuffer,
      Buffer.from(envelope.nonce),
      { authTagLength: AES_GCM_AUTH_TAG_BYTES_V1 },
    )
    decipher.setAuthTag(Buffer.from(envelope.authTag))
    decipher.setAAD(expectedAad)
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext)),
      decipher.final(),
    ])
    return new Uint8Array(plaintext)
  } catch (error) {
    if (error instanceof CredentialResolutionError) throw error
    throw unreadable()
  } finally {
    dekBuffer?.fill(0)
    expectedAad?.fill(0)
    persistedAad?.fill(0)
    plaintext?.fill(0)
  }
}
