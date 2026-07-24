import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'

import type {
  GeneratedWorkspaceDekV1,
  WorkspaceKekContextV1,
  WorkspaceKekProviderV1,
  WrappedWorkspaceDekV1,
} from '../../../shared/credentials'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
  WORKSPACE_KEK_PROVIDER_VERSION,
} from '../../../shared/credentials'
import {
  constantTimeBytesEqualV1,
  constantTimeTextEqualV1,
  encodeCanonicalTupleV1,
} from '../canonicalEncoding'
import { readSealedHostFileV1 } from '../sealedFile'

const LOCAL_KEK_PROVIDER_ID_V1 = 'local-kek'
const LOCAL_KEK_BYTES_V1 = 32
const LOCAL_WRAP_NONCE_BYTES_V1 = 12
const LOCAL_WRAP_TAG_BYTES_V1 = 16
const LOCAL_KEK_AAD_DOMAIN_V1 = 2

export interface LocalKekFileV1 {
  readonly keyVersion: number
  readonly keyRef: string
  readonly filePath: string
}

export interface LocalKekProviderOptionsV1 {
  readonly providerId?: string
  readonly currentKeyVersion: number
  readonly keyFiles: readonly LocalKekFileV1[]
  readonly expectedOwnerUid?: number
}

interface LoadedLocalKekV1 {
  readonly keyVersion: number
  readonly keyRef: string
  readonly key: Buffer
}

function unreadable(): CredentialResolutionError {
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.UNREADABLE,
    'Wrapped workspace key is unreadable',
  )
}

function backendUnavailable(): CredentialResolutionError {
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
    'Local KEK backend is unavailable',
  )
}

function isAllZero(bytes: Uint8Array): boolean {
  let aggregate = 0
  for (const byte of bytes) aggregate |= byte
  return aggregate === 0
}

function validateContext(context: WorkspaceKekContextV1): void {
  if (
    !context
    || typeof context.workspaceId !== 'string'
    || context.workspaceId.length === 0
    || typeof context.requestId !== 'string'
    || context.requestId.length === 0
    || context.requestId.length > 256
    || !Number.isSafeInteger(context.dekGeneration)
    || context.dekGeneration <= 0
  ) {
    throw unreadable()
  }
}

function localKekAad(
  context: WorkspaceKekContextV1,
  providerId: string,
  keyRef: string,
  keyVersion: number,
): Buffer {
  try {
    return encodeCanonicalTupleV1(LOCAL_KEK_AAD_DOMAIN_V1, [
      context.workspaceId,
      context.dekGeneration,
      providerId,
      keyRef,
      keyVersion,
    ])
  } catch {
    throw unreadable()
  }
}

function loadKeys(options: LocalKekProviderOptionsV1): Readonly<{
  keys: Map<number, LoadedLocalKekV1>
  reasonCode?: string
}> {
  const keys = new Map<number, LoadedLocalKekV1>()
  const keyRefs = new Set<string>()
  if (
    !Number.isSafeInteger(options.currentKeyVersion)
    || options.currentKeyVersion <= 0
    || !Array.isArray(options.keyFiles)
    || options.keyFiles.length === 0
  ) {
    return { keys, reasonCode: 'LOCAL_KEK_CONFIG_INVALID' }
  }
  for (const keyFile of options.keyFiles) {
    if (
      !Number.isSafeInteger(keyFile.keyVersion)
      || keyFile.keyVersion <= 0
      || typeof keyFile.keyRef !== 'string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,255}$/.test(keyFile.keyRef)
      || keys.has(keyFile.keyVersion)
      || keyRefs.has(keyFile.keyRef)
    ) {
      for (const loaded of keys.values()) loaded.key.fill(0)
      keys.clear()
      return { keys, reasonCode: 'LOCAL_KEK_CONFIG_INVALID' }
    }
    const result = readSealedHostFileV1(keyFile.filePath, {
      expectedOwnerUid: options.expectedOwnerUid,
      maximumBytes: LOCAL_KEK_BYTES_V1,
      exactBytes: LOCAL_KEK_BYTES_V1,
    })
    if (!result.ok) {
      for (const loaded of keys.values()) loaded.key.fill(0)
      keys.clear()
      return { keys, reasonCode: `LOCAL_KEK_${result.reasonCode}` }
    }
    let keyAggregate = 0
    for (const byte of result.bytes) keyAggregate |= byte
    if (keyAggregate === 0) {
      result.bytes.fill(0)
      for (const existing of keys.values()) existing.key.fill(0)
      keys.clear()
      return { keys, reasonCode: 'LOCAL_KEK_ZERO_KEY_FORBIDDEN' }
    }
    keyRefs.add(keyFile.keyRef)
    keys.set(keyFile.keyVersion, {
      keyVersion: keyFile.keyVersion,
      keyRef: keyFile.keyRef,
      key: result.bytes,
    })
  }
  if (!keys.has(options.currentKeyVersion)) {
    for (const loaded of keys.values()) loaded.key.fill(0)
    keys.clear()
    return { keys, reasonCode: 'LOCAL_KEK_CURRENT_VERSION_MISSING' }
  }
  return { keys }
}

export function createLocalKekProviderV1(
  options: LocalKekProviderOptionsV1,
): WorkspaceKekProviderV1 {
  const providerId = options.providerId ?? LOCAL_KEK_PROVIDER_ID_V1
  const providerIdValid = /^[a-z0-9][a-z0-9._-]{0,63}$/.test(providerId)
  const loaded = loadKeys(options)
  let reasonCode = providerIdValid
    ? loaded.reasonCode
    : 'LOCAL_KEK_PROVIDER_ID_INVALID'
  if (!providerIdValid) {
    for (const key of loaded.keys.values()) key.key.fill(0)
    loaded.keys.clear()
  }
  let closed = false

  function currentKey(): LoadedLocalKekV1 {
    if (closed || reasonCode) throw backendUnavailable()
    const key = loaded.keys.get(options.currentKeyVersion)
    if (!key) throw backendUnavailable()
    return key
  }

  function wrap(
    context: WorkspaceKekContextV1,
    plaintextDek: Uint8Array,
    key: LoadedLocalKekV1,
  ): WrappedWorkspaceDekV1 {
    validateContext(context)
    if (plaintextDek.byteLength !== 32) throw unreadable()
    let plaintextBuffer: Buffer | undefined
    let keyBuffer: Buffer | undefined
    let aad: Buffer | undefined
    let nonce: Buffer | undefined
    try {
      plaintextBuffer = Buffer.from(plaintextDek)
      keyBuffer = Buffer.from(key.key)
      aad = localKekAad(
        context,
        providerId,
        key.keyRef,
        key.keyVersion,
      )
      nonce = randomBytes(LOCAL_WRAP_NONCE_BYTES_V1)
      if (isAllZero(nonce)) throw unreadable()
      const cipher = createCipheriv('aes-256-gcm', keyBuffer, nonce, {
        authTagLength: LOCAL_WRAP_TAG_BYTES_V1,
      })
      cipher.setAAD(aad)
      const ciphertext = Buffer.concat([
        cipher.update(plaintextBuffer),
        cipher.final(),
      ])
      const authTag = cipher.getAuthTag()
      return {
        providerId,
        keyRef: key.keyRef,
        keyVersion: key.keyVersion,
        payload: {
          format: 'local-aes-256-gcm.v1',
          ciphertext: new Uint8Array(ciphertext),
          nonce: new Uint8Array(nonce),
          authTag: new Uint8Array(authTag),
          aadContext: new Uint8Array(aad),
        },
      }
    } catch (error) {
      if (error instanceof CredentialResolutionError) throw error
      throw unreadable()
    } finally {
      plaintextBuffer?.fill(0)
      keyBuffer?.fill(0)
      aad?.fill(0)
      nonce?.fill(0)
    }
  }

  function unwrap(
    context: WorkspaceKekContextV1,
    wrapped: WrappedWorkspaceDekV1,
  ): Uint8Array {
    validateContext(context)
    if (closed || reasonCode) throw backendUnavailable()
    if (
      !wrapped
      || typeof wrapped.providerId !== 'string'
      || typeof wrapped.keyRef !== 'string'
      || !wrapped.payload
      || typeof wrapped.payload !== 'object'
      || !constantTimeTextEqualV1(wrapped.providerId, providerId)
      || !Number.isSafeInteger(wrapped.keyVersion)
    ) {
      throw unreadable()
    }
    const key = loaded.keys.get(wrapped.keyVersion)
    if (
      !key
      || !constantTimeTextEqualV1(wrapped.keyRef, key.keyRef)
      || wrapped.payload.format !== 'local-aes-256-gcm.v1'
      || !(wrapped.payload.ciphertext instanceof Uint8Array)
      || wrapped.payload.ciphertext.byteLength !== 32
      || !(wrapped.payload.nonce instanceof Uint8Array)
      || wrapped.payload.nonce.byteLength !== LOCAL_WRAP_NONCE_BYTES_V1
      || isAllZero(wrapped.payload.nonce)
      || !(wrapped.payload.authTag instanceof Uint8Array)
      || wrapped.payload.authTag.byteLength !== LOCAL_WRAP_TAG_BYTES_V1
      || !(wrapped.payload.aadContext instanceof Uint8Array)
    ) {
      throw unreadable()
    }
    let expectedAad: Buffer | undefined
    let keyBuffer: Buffer | undefined
    let plaintext: Buffer | undefined
    try {
      expectedAad = localKekAad(
        context,
        providerId,
        key.keyRef,
        key.keyVersion,
      )
      keyBuffer = Buffer.from(key.key)
      if (!constantTimeBytesEqualV1(wrapped.payload.aadContext, expectedAad)) {
        throw unreadable()
      }
      const decipher = createDecipheriv(
        'aes-256-gcm',
        keyBuffer,
        Buffer.from(wrapped.payload.nonce),
        { authTagLength: LOCAL_WRAP_TAG_BYTES_V1 },
      )
      decipher.setAuthTag(Buffer.from(wrapped.payload.authTag))
      decipher.setAAD(expectedAad)
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(wrapped.payload.ciphertext)),
        decipher.final(),
      ])
      if (plaintext.byteLength !== 32) throw unreadable()
      return new Uint8Array(plaintext)
    } catch (error) {
      if (error instanceof CredentialResolutionError) throw error
      throw unreadable()
    } finally {
      expectedAad?.fill(0)
      keyBuffer?.fill(0)
      plaintext?.fill(0)
    }
  }

  return Object.freeze({
    contractVersion: WORKSPACE_KEK_PROVIDER_VERSION,
    providerId,
    async readiness() {
      return closed || reasonCode
        ? { ready: false, reasonCode: closed ? 'LOCAL_KEK_CLOSED' : reasonCode }
        : { ready: true }
    },
    async generateDataKey(
      context: WorkspaceKekContextV1,
    ): Promise<GeneratedWorkspaceDekV1> {
      const key = currentKey()
      validateContext(context)
      const plaintextDek = randomBytes(32)
      try {
        if (isAllZero(plaintextDek)) throw backendUnavailable()
        return {
          plaintextDek: new Uint8Array(plaintextDek),
          wrappedDek: wrap(context, plaintextDek, key),
        }
      } finally {
        plaintextDek.fill(0)
      }
    },
    async unwrapDataKey(
      context: WorkspaceKekContextV1,
      wrapped: WrappedWorkspaceDekV1,
    ): Promise<Uint8Array> {
      return unwrap(context, wrapped)
    },
    async rewrapDataKey(
      context: WorkspaceKekContextV1,
      wrapped: WrappedWorkspaceDekV1,
    ): Promise<WrappedWorkspaceDekV1> {
      const plaintextDek = unwrap(context, wrapped)
      try {
        return wrap(context, plaintextDek, currentKey())
      } finally {
        plaintextDek.fill(0)
      }
    },
    async close(): Promise<void> {
      if (closed) return
      closed = true
      reasonCode = 'LOCAL_KEK_CLOSED'
      for (const key of loaded.keys.values()) key.key.fill(0)
      loaded.keys.clear()
    },
  })
}
