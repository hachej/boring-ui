import { readFile } from 'node:fs/promises'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'
import {
  CREDENTIAL_AAD_ENCODING_VERSION,
  CREDENTIAL_AUTH_TAG_BYTE_LENGTH_V1,
  CREDENTIAL_DEK_BYTE_LENGTH_V1,
  CREDENTIAL_ERROR_CODES,
  CREDENTIAL_KEK_BYTE_LENGTH_V1,
  CREDENTIAL_NONCE_BYTE_LENGTH_V1,
  CredentialResolutionError,
  WORKSPACE_KEK_PROVIDER_VERSION,
} from '../../../shared/credentials'
import type {
  GeneratedWorkspaceDekV1,
  WorkspaceKekContextV1,
  WorkspaceKekProviderReadinessV1,
  WorkspaceKekProviderV1,
  WrappedWorkspaceDekV1,
} from '../../../shared/credentials'
import { bytesEqualConstantTimeV1 } from './envelopeCrypto'

/**
 * Local-KEK `KmsBackend` implementation
 * (docs/issues/820/byok-secret-vault-plan.md, "Explicit local-KEK/self-host
 * provider").
 *
 * Selection is immutable startup configuration. The KEK is a 32-byte key
 * generated OUTSIDE the app and stored OUTSIDE Postgres, in an operator-owned
 * sealed file mounted read-only. There is deliberately no plaintext-env key
 * default: `resolveLocalKekProviderConfigV1` requires an explicit backend
 * selection plus an explicit file path, and a missing/wrong/unreadable KEK
 * fails closed. This provider never falls back to another backend, to
 * `WORKSPACE_SETTINGS_ENCRYPTION_KEY`, or to plaintext.
 *
 * Blast radius honesty: the service necessarily holds this KEK transiently in
 * memory, so an app compromise is worse than a remote KMS/Transit backend. Node
 * and V8 cannot guarantee erasure; buffers are overwritten in `finally` on a
 * best-effort basis only.
 */

export const LOCAL_KEK_PROVIDER_ID_V1 = 'local-kek' as const

const LOCAL_WRAPPED_DEK_FORMAT_V1 = 'local-aes-256-gcm.v1' as const
const LOCAL_KEK_CIPHER_ALGORITHM_V1 = 'aes-256-gcm' as const

/** Env keys. Both must be set explicitly; neither has a silent default. */
export const LOCAL_KEK_BACKEND_ENV_KEY_V1 = 'BORING_CREDENTIAL_KMS_BACKEND'
export const LOCAL_KEK_FILE_ENV_KEY_V1 = 'BORING_CREDENTIAL_LOCAL_KEK_FILE'
export const LOCAL_KEK_KEY_REF_ENV_KEY_V1 = 'BORING_CREDENTIAL_LOCAL_KEK_REF'
export const LOCAL_KEK_KEY_VERSION_ENV_KEY_V1 =
  'BORING_CREDENTIAL_LOCAL_KEK_VERSION'

/** Readiness reason codes are metadata only; they never describe key bytes. */
export const LOCAL_KEK_READINESS_REASONS_V1 = {
  UNREADABLE_SOURCE: 'local-kek-source-unreadable',
  INVALID_LENGTH: 'local-kek-invalid-length',
} as const

export type LocalKekSourceV1 = () => Promise<Uint8Array>

export interface LocalKekProviderOptionsV1 {
  /** Opaque, non-secret identifier of the KEK this instance is configured for. */
  readonly keyRef: string
  readonly keyVersion: number
  /** Loads the 32-byte KEK. Throws or returns bad length => fail closed. */
  readonly loadKek: LocalKekSourceV1
}

export interface LocalKekProviderConfigV1 {
  readonly backend: typeof LOCAL_KEK_PROVIDER_ID_V1
  readonly keyFilePath: string
  readonly keyRef: string
  readonly keyVersion: number
}

function kekUnavailable(message: string): never {
  throw new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.KEK_UNAVAILABLE,
    message,
  )
}

function unreadable(message: string): never {
  throw new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.UNREADABLE,
    message,
  )
}

function notConfigured(message: string): never {
  throw new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
    message,
  )
}

/**
 * Reads the immutable startup selection from an env-shaped record. The caller
 * (composition root, under `src/server/config/**`) supplies the record; this
 * module never touches `process.env` itself.
 *
 * Returns `undefined` when the local-KEK backend was not selected, so the host
 * can decide (and fail closed) rather than this module inventing a default.
 */
export function resolveLocalKekProviderConfigV1(
  env: Readonly<Record<string, string | undefined>>,
): LocalKekProviderConfigV1 | undefined {
  const backend = env[LOCAL_KEK_BACKEND_ENV_KEY_V1]?.trim()
  if (!backend) return undefined
  if (backend !== LOCAL_KEK_PROVIDER_ID_V1) return undefined

  const keyFilePath = env[LOCAL_KEK_FILE_ENV_KEY_V1]?.trim()
  if (!keyFilePath) {
    notConfigured(
      `Local-KEK credential backend requires ${LOCAL_KEK_FILE_ENV_KEY_V1}`,
    )
  }
  const keyRef = env[LOCAL_KEK_KEY_REF_ENV_KEY_V1]?.trim() || 'default'
  const rawVersion = env[LOCAL_KEK_KEY_VERSION_ENV_KEY_V1]?.trim()
  const keyVersion = rawVersion === undefined || rawVersion === ''
    ? 1
    : Number(rawVersion)
  if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0) {
    notConfigured(
      `Local-KEK credential backend has an invalid ${LOCAL_KEK_KEY_VERSION_ENV_KEY_V1}`,
    )
  }
  return Object.freeze({
    backend: LOCAL_KEK_PROVIDER_ID_V1,
    keyFilePath,
    keyRef,
    keyVersion,
  })
}

/**
 * File-backed KEK source. The file holds exactly one 32-byte key encoded as
 * hex (64 chars) or base64 (44 chars), or as 32 raw bytes. Anything else is a
 * fail-closed configuration error, not a "best guess".
 */
export function createLocalKekFileSourceV1(
  keyFilePath: string,
): LocalKekSourceV1 {
  return async () => {
    let raw: Buffer
    try {
      raw = await readFile(keyFilePath)
    } catch {
      // Never echo the OS error: it can contain operator path/permission detail.
      kekUnavailable('Local credential KEK source is unreadable')
    }
    return decodeLocalKekMaterialV1(raw)
  }
}

/**
 * Decodes the file's bytes. Length validation is centralized in the provider,
 * so an undecodable file surfaces as invalid material rather than as a partial
 * "best guess" key. Exported for conformance tests.
 */
export function decodeLocalKekMaterialV1(raw: Buffer): Uint8Array {
  if (raw.byteLength === CREDENTIAL_KEK_BYTE_LENGTH_V1) {
    return new Uint8Array(raw)
  }
  const text = raw.toString('utf8').trim()
  if (/^[0-9a-fA-F]{64}$/.test(text)) {
    return new Uint8Array(Buffer.from(text, 'hex'))
  }
  if (/^[A-Za-z0-9+/]{43}=$/.test(text)) {
    const decoded = Buffer.from(text, 'base64')
    if (decoded.byteLength === CREDENTIAL_KEK_BYTE_LENGTH_V1) {
      return new Uint8Array(decoded)
    }
  }
  return new Uint8Array(raw)
}

function encodeWrappedDekAadV1(
  context: WorkspaceKekContextV1,
  keyRef: string,
  keyVersion: number,
): Buffer {
  const components = [
    LOCAL_KEK_PROVIDER_ID_V1,
    LOCAL_WRAPPED_DEK_FORMAT_V1,
    context.workspaceId,
    String(context.dekGeneration),
    keyRef,
    String(keyVersion),
  ]
  const chunks: Buffer[] = [
    Buffer.from(`${CREDENTIAL_AAD_ENCODING_VERSION}:kek`, 'utf8'),
  ]
  for (const component of components) {
    const bytes = Buffer.from(component, 'utf8')
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32BE(bytes.byteLength, 0)
    chunks.push(length, bytes)
  }
  return Buffer.concat(chunks)
}

function assertContext(context: WorkspaceKekContextV1): void {
  if (
    !context
    || typeof context.workspaceId !== 'string'
    || context.workspaceId.length === 0
    || !Number.isSafeInteger(context.dekGeneration)
    || context.dekGeneration <= 0
    || typeof context.requestId !== 'string'
    || context.requestId.length === 0
  ) {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.SCHEMA_MISMATCH,
      'Invalid workspace KEK context',
    )
  }
}

export function createLocalKekWorkspaceKekProviderV1(
  options: LocalKekProviderOptionsV1,
): WorkspaceKekProviderV1 {
  if (
    typeof options?.keyRef !== 'string'
    || options.keyRef.length === 0
    || !Number.isSafeInteger(options.keyVersion)
    || options.keyVersion <= 0
    || typeof options.loadKek !== 'function'
  ) {
    throw new CredentialResolutionError(
      CREDENTIAL_ERROR_CODES.NOT_CONFIGURED,
      'Local-KEK credential backend is misconfigured',
    )
  }

  type KekLoadResultV1 =
    | Readonly<{ ok: true; kek: Buffer }>
    | Readonly<{ ok: false; reasonCode: string }>

  async function tryLoadKek(): Promise<KekLoadResultV1> {
    let material: Uint8Array
    try {
      material = await options.loadKek()
    } catch {
      // The underlying OS/decode error is never surfaced or logged: it can
      // carry operator path/permission detail and, in a bad source, key bytes.
      return {
        ok: false,
        reasonCode: LOCAL_KEK_READINESS_REASONS_V1.UNREADABLE_SOURCE,
      }
    }
    if (!(material instanceof Uint8Array)) {
      return {
        ok: false,
        reasonCode: LOCAL_KEK_READINESS_REASONS_V1.UNREADABLE_SOURCE,
      }
    }
    if (material.byteLength !== CREDENTIAL_KEK_BYTE_LENGTH_V1) {
      return {
        ok: false,
        reasonCode: LOCAL_KEK_READINESS_REASONS_V1.INVALID_LENGTH,
      }
    }
    return { ok: true, kek: Buffer.from(material) }
  }

  async function loadKekBuffer(): Promise<Buffer> {
    const result = await tryLoadKek()
    if (!result.ok) {
      kekUnavailable(
        `Local credential KEK is unavailable (${result.reasonCode})`,
      )
    }
    return result.kek
  }

  function requireLocalPayload(
    wrapped: WrappedWorkspaceDekV1,
  ): Extract<
    WrappedWorkspaceDekV1['payload'],
    { format: typeof LOCAL_WRAPPED_DEK_FORMAT_V1 }
  > {
    if (
      !wrapped
      || wrapped.providerId !== LOCAL_KEK_PROVIDER_ID_V1
      || typeof wrapped.keyRef !== 'string'
      || !Number.isSafeInteger(wrapped.keyVersion)
    ) {
      // An envelope written by another backend is never opportunistically read.
      unreadable('Wrapped workspace data key was written by another backend')
    }
    const payload = wrapped.payload
    if (!payload || payload.format !== LOCAL_WRAPPED_DEK_FORMAT_V1) {
      unreadable('Wrapped workspace data key has an unsupported format')
    }
    if (
      !(payload.ciphertext instanceof Uint8Array)
      || !(payload.nonce instanceof Uint8Array)
      || !(payload.authTag instanceof Uint8Array)
      || !(payload.aadContext instanceof Uint8Array)
      || payload.nonce.byteLength !== CREDENTIAL_NONCE_BYTE_LENGTH_V1
      || payload.authTag.byteLength !== CREDENTIAL_AUTH_TAG_BYTE_LENGTH_V1
    ) {
      unreadable('Wrapped workspace data key is malformed')
    }
    return payload
  }

  function wrapWithKek(
    kek: Buffer,
    context: WorkspaceKekContextV1,
    plaintextDek: Buffer,
  ): WrappedWorkspaceDekV1 {
    const aad = encodeWrappedDekAadV1(context, options.keyRef, options.keyVersion)
    const nonce = randomBytes(CREDENTIAL_NONCE_BYTE_LENGTH_V1)
    const cipher = createCipheriv(LOCAL_KEK_CIPHER_ALGORITHM_V1, kek, nonce, {
      authTagLength: CREDENTIAL_AUTH_TAG_BYTE_LENGTH_V1,
    })
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([
      cipher.update(plaintextDek),
      cipher.final(),
    ])
    return Object.freeze({
      providerId: LOCAL_KEK_PROVIDER_ID_V1,
      keyRef: options.keyRef,
      keyVersion: options.keyVersion,
      payload: Object.freeze({
        format: LOCAL_WRAPPED_DEK_FORMAT_V1,
        ciphertext: new Uint8Array(ciphertext),
        nonce: new Uint8Array(nonce),
        authTag: new Uint8Array(cipher.getAuthTag()),
        aadContext: new Uint8Array(aad),
      }),
    })
  }

  function unwrapWithKek(
    kek: Buffer,
    context: WorkspaceKekContextV1,
    wrapped: WrappedWorkspaceDekV1,
  ): Buffer {
    const payload = requireLocalPayload(wrapped)
    const expectedAad = encodeWrappedDekAadV1(
      context,
      wrapped.keyRef,
      wrapped.keyVersion,
    )
    if (!bytesEqualConstantTimeV1(payload.aadContext, expectedAad)) {
      unreadable('Wrapped workspace data key failed authentication')
    }
    let plaintext: Buffer
    try {
      const decipher = createDecipheriv(
        LOCAL_KEK_CIPHER_ALGORITHM_V1,
        kek,
        Buffer.from(payload.nonce),
        { authTagLength: CREDENTIAL_AUTH_TAG_BYTE_LENGTH_V1 },
      )
      decipher.setAAD(expectedAad)
      decipher.setAuthTag(Buffer.from(payload.authTag))
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(payload.ciphertext)),
        decipher.final(),
      ])
    } catch (error) {
      if (error instanceof CredentialResolutionError) throw error
      unreadable('Wrapped workspace data key failed authentication')
    }
    if (plaintext.byteLength !== CREDENTIAL_DEK_BYTE_LENGTH_V1) {
      plaintext.fill(0)
      unreadable('Wrapped workspace data key has an invalid length')
    }
    return plaintext
  }

  return Object.freeze({
    contractVersion: WORKSPACE_KEK_PROVIDER_VERSION,
    providerId: LOCAL_KEK_PROVIDER_ID_V1,

    async generateDataKey(
      context: WorkspaceKekContextV1,
    ): Promise<GeneratedWorkspaceDekV1> {
      assertContext(context)
      const kek = await loadKekBuffer()
      const plaintextDek = randomBytes(CREDENTIAL_DEK_BYTE_LENGTH_V1)
      try {
        return Object.freeze({
          plaintextDek: new Uint8Array(plaintextDek),
          wrappedDek: wrapWithKek(kek, context, plaintextDek),
        })
      } finally {
        // Best effort only: Node/V8 cannot guarantee erasure.
        plaintextDek.fill(0)
        kek.fill(0)
      }
    },

    async unwrapDataKey(
      context: WorkspaceKekContextV1,
      wrapped: WrappedWorkspaceDekV1,
    ): Promise<Uint8Array> {
      assertContext(context)
      const kek = await loadKekBuffer()
      let plaintextDek: Buffer | undefined
      try {
        plaintextDek = unwrapWithKek(kek, context, wrapped)
        return new Uint8Array(plaintextDek)
      } finally {
        plaintextDek?.fill(0)
        kek.fill(0)
      }
    },

    async rewrapDataKey(
      context: WorkspaceKekContextV1,
      wrapped: WrappedWorkspaceDekV1,
    ): Promise<WrappedWorkspaceDekV1> {
      assertContext(context)
      const kek = await loadKekBuffer()
      let plaintextDek: Buffer | undefined
      try {
        plaintextDek = unwrapWithKek(kek, context, wrapped)
        return wrapWithKek(kek, context, plaintextDek)
      } finally {
        plaintextDek?.fill(0)
        kek.fill(0)
      }
    },

    async readiness(): Promise<WorkspaceKekProviderReadinessV1> {
      // Readiness reports; it never throws and never falls back to a default.
      const result = await tryLoadKek()
      if (!result.ok) {
        return Object.freeze({ ready: false, reasonCode: result.reasonCode })
      }
      result.kek.fill(0)
      return Object.freeze({ ready: true })
    },
  })
}

/**
 * Convenience composition for self-host deployments. Returns `undefined` when
 * the local-KEK backend was not explicitly selected; the caller must then fail
 * closed rather than substitute a default.
 */
export function createLocalKekWorkspaceKekProviderFromEnvV1(
  env: Readonly<Record<string, string | undefined>>,
): WorkspaceKekProviderV1 | undefined {
  const config = resolveLocalKekProviderConfigV1(env)
  if (!config) return undefined
  return createLocalKekWorkspaceKekProviderV1({
    keyRef: config.keyRef,
    keyVersion: config.keyVersion,
    loadKek: createLocalKekFileSourceV1(config.keyFilePath),
  })
}
