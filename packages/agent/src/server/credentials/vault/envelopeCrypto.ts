import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import {
  CREDENTIAL_AAD_ENCODING_VERSION,
  CREDENTIAL_AUTH_TAG_BYTE_LENGTH_V1,
  CREDENTIAL_ENVELOPE_VERSION,
  CREDENTIAL_ERROR_CODES,
  CREDENTIAL_NONCE_BYTE_LENGTH_V1,
  CredentialResolutionError,
} from '../../../shared/credentials'
import type {
  CredentialEnvelopeV1,
  CredentialFieldAadContextV1,
} from '../../../shared/credentials'

/**
 * AES-256-GCM field envelope crypto (docs/issues/820/byok-secret-vault-plan.md,
 * "Envelope model").
 *
 * Hard rules encoded here:
 * - 12-byte random nonce per encryption, never reused, never static/zero.
 * - 16-byte auth tag, always verified; authentication failure is
 *   `CREDENTIAL_UNREADABLE` and is never treated as "absent".
 * - AAD is a canonical, versioned, unambiguous encoding of
 *   `workspaceId:credentialId:providerId:fieldId:credentialVersion:dekGeneration`
 *   applied via `setAAD()` before finalization on both sides.
 * - No ECB/CBC, no `createCipher`, no `Math.random`, no `==` on secret state.
 * - Error messages carry stable codes only; never plaintext or key material.
 */

export const CREDENTIAL_FIELD_CIPHER_ALGORITHM_V1 = 'aes-256-gcm' as const

const AAD_ENCODING_PREFIX = Buffer.from(
  CREDENTIAL_AAD_ENCODING_VERSION,
  'utf8',
)

function unreadable(message: string): never {
  throw new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.UNREADABLE,
    message,
  )
}

function schemaMismatch(message: string): never {
  throw new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
    message,
  )
}

/**
 * Canonical AAD encoding: a version prefix followed by every component as a
 * 4-byte big-endian length prefix plus its UTF-8 bytes. Length prefixing keeps
 * the encoding unambiguous — no component value can impersonate a boundary, so
 * `("a", "bc")` and `("ab", "c")` never collide.
 */
export function encodeCredentialFieldAadV1(
  context: CredentialFieldAadContextV1,
): Buffer {
  if (
    typeof context?.workspaceId !== 'string'
    || context.workspaceId.length === 0
    || typeof context.credentialId !== 'string'
    || context.credentialId.length === 0
    || typeof context.providerId !== 'string'
    || context.providerId.length === 0
    || typeof context.fieldId !== 'string'
    || context.fieldId.length === 0
    || !Number.isSafeInteger(context.credentialVersion)
    || context.credentialVersion <= 0
    || !Number.isSafeInteger(context.dekGeneration)
    || context.dekGeneration <= 0
  ) {
    schemaMismatch('Invalid credential envelope AAD context')
  }
  const components = [
    context.workspaceId,
    context.credentialId,
    context.providerId,
    context.fieldId,
    String(context.credentialVersion),
    String(context.dekGeneration),
  ]
  const chunks: Buffer[] = [AAD_ENCODING_PREFIX]
  for (const component of components) {
    const bytes = Buffer.from(component, 'utf8')
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32BE(bytes.byteLength, 0)
    chunks.push(length, bytes)
  }
  return Buffer.concat(chunks)
}

/** Constant-time byte equality with an explicit length guard. */
export function bytesEqualConstantTimeV1(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (
    !(left instanceof Uint8Array)
    || !(right instanceof Uint8Array)
    || left.byteLength !== right.byteLength
  ) {
    return false
  }
  return timingSafeEqual(Buffer.from(left), Buffer.from(right))
}

/**
 * Encrypt one credential field under the workspace DEK.
 *
 * `plaintextDek` and `plaintext` stay owned by the caller; this function copies
 * nothing it does not need and returns only ciphertext material.
 */
export function encryptCredentialFieldV1(input: Readonly<{
  plaintextDek: Uint8Array
  plaintext: Uint8Array
  aadContext: CredentialFieldAadContextV1
}>): CredentialEnvelopeV1 {
  if (!(input.plaintext instanceof Uint8Array)) {
    schemaMismatch('Invalid credential field plaintext')
  }
  const aad = encodeCredentialFieldAadV1(input.aadContext)
  const key = assertDekBytes(input.plaintextDek)
  const nonce = randomBytes(CREDENTIAL_NONCE_BYTE_LENGTH_V1)
  const cipher = createCipheriv(
    CREDENTIAL_FIELD_CIPHER_ALGORITHM_V1,
    key,
    nonce,
    { authTagLength: CREDENTIAL_AUTH_TAG_BYTE_LENGTH_V1 },
  )
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(input.plaintext)),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()
  if (authTag.byteLength !== CREDENTIAL_AUTH_TAG_BYTE_LENGTH_V1) {
    unreadable('Credential envelope produced an invalid authentication tag')
  }
  return Object.freeze({
    envelopeVersion: CREDENTIAL_ENVELOPE_VERSION,
    ciphertext: new Uint8Array(ciphertext),
    nonce: new Uint8Array(nonce),
    authTag: new Uint8Array(authTag),
    aadContext: new Uint8Array(aad),
  })
}

/**
 * Decrypt one credential field. The persisted AAD is recomputed from the
 * caller's identity and compared in constant time before tag verification, so a
 * row moved between workspaces/providers/fields/versions/generations fails.
 */
export function decryptCredentialFieldV1(input: Readonly<{
  plaintextDek: Uint8Array
  envelope: CredentialEnvelopeV1
  aadContext: CredentialFieldAadContextV1
}>): Buffer {
  const envelope = input.envelope
  if (
    !envelope
    || envelope.envelopeVersion !== CREDENTIAL_ENVELOPE_VERSION
    || !(envelope.ciphertext instanceof Uint8Array)
    || !(envelope.nonce instanceof Uint8Array)
    || !(envelope.authTag instanceof Uint8Array)
    || !(envelope.aadContext instanceof Uint8Array)
  ) {
    unreadable('Credential envelope is malformed')
  }
  if (
    envelope.nonce.byteLength !== CREDENTIAL_NONCE_BYTE_LENGTH_V1
    || envelope.authTag.byteLength !== CREDENTIAL_AUTH_TAG_BYTE_LENGTH_V1
  ) {
    unreadable('Credential envelope is malformed')
  }
  const expectedAad = encodeCredentialFieldAadV1(input.aadContext)
  if (!bytesEqualConstantTimeV1(envelope.aadContext, expectedAad)) {
    unreadable('Credential envelope failed authentication')
  }
  const key = assertDekBytes(input.plaintextDek)
  try {
    const decipher = createDecipheriv(
      CREDENTIAL_FIELD_CIPHER_ALGORITHM_V1,
      key,
      Buffer.from(envelope.nonce),
      { authTagLength: CREDENTIAL_AUTH_TAG_BYTE_LENGTH_V1 },
    )
    decipher.setAAD(expectedAad)
    decipher.setAuthTag(Buffer.from(envelope.authTag))
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext)),
      decipher.final(),
    ])
  } catch (error) {
    if (error instanceof CredentialResolutionError) throw error
    // Never surface the underlying OpenSSL message; it is code-only from here.
    unreadable('Credential envelope failed authentication')
  }
}

function assertDekBytes(dek: unknown): Buffer {
  if (!(dek instanceof Uint8Array) || dek.byteLength !== 32) {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.KEK_UNAVAILABLE,
      'Workspace data key is unavailable or malformed',
    )
  }
  return Buffer.from(dek.buffer, dek.byteOffset, dek.byteLength)
}
