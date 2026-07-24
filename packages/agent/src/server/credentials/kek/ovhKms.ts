import { Agent, request as httpsRequest } from 'node:https'
import { createSecureContext } from 'node:tls'

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
} from '../canonicalEncoding'
import { readSealedHostFileV1 } from '../sealedFile'

export const OVH_KMS_PAYLOAD_FORMAT_V1 =
  'ovhcloud-kms-rest-mtls.datakey.v1' as const
export const OVH_KMS_ROUTE_RESOLVER_VERSION_V1 =
  'boring.ovh-kms-workspace-key-route-resolver.v1' as const

const OVH_KMS_PROVIDER_ID_V1 = 'ovh-kms'
const OVH_KMS_PAYLOAD_MAGIC_V1 = Buffer.from([0x42, 0x4f, 0x4b, 0x31])
const MAX_OVH_KMS_RESPONSE_BYTES_V1 = 128 * 1024
const MAX_OVH_KMS_WRAPPED_KEY_BYTES_V1 = 64 * 1024
const MAX_OVH_KMS_MTLS_FILE_BYTES_V1 = 64 * 1024

export interface OvhKmsHttpRequestV1 {
  readonly method: 'POST'
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: Uint8Array
}

export interface OvhKmsHttpResponseV1 {
  readonly status: number
  readonly body: Uint8Array
}

export interface OvhKmsHttpTransportV1 {
  readonly contractVersion: 'boring.ovh-kms-http-transport.v1'
  readiness(): Promise<Readonly<{ ready: boolean; reasonCode?: string }>>
  request(request: OvhKmsHttpRequestV1): Promise<OvhKmsHttpResponseV1>
  close?(): Promise<void>
}

export interface OvhKmsMtlsHttpTransportOptionsV1 {
  readonly endpointOrigin: string
  readonly clientCertificatePath: string
  readonly clientPrivateKeyPath: string
  readonly caCertificatePath?: string
  readonly expectedOwnerUid?: number
  readonly requestTimeoutMs?: number
}

export interface OvhKmsProviderOptionsV1 {
  readonly providerId?: string
  readonly workspaceKeyRouteResolver: OvhKmsWorkspaceKeyRouteResolverV1
}

export interface OvhKmsWorkspaceKeyRouteV1 {
  readonly workspaceId: string
  readonly region: string
  readonly endpointOrigin: string
  readonly serviceKeyId: string
  readonly keyVersion: number
  readonly transport: OvhKmsHttpTransportV1
}

export interface OvhKmsWorkspaceKeyRouteResolverV1 {
  readonly contractVersion: typeof OVH_KMS_ROUTE_RESOLVER_VERSION_V1
  readiness(): Promise<Readonly<{ ready: boolean; reasonCode?: string }>>
  resolve(workspaceId: string): Promise<OvhKmsWorkspaceKeyRouteV1 | undefined>
  close?(): Promise<void>
}

function unreadable(): CredentialResolutionError {
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.UNREADABLE,
    'OVH KMS wrapped workspace key is unreadable',
  )
}

function backendUnavailable(retryable = true): CredentialResolutionError {
  return new CredentialResolutionError(
    CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
    'OVH KMS backend is unavailable',
    { retryable },
  )
}

function validRegion(region: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+){1,5}$/.test(region)
}

function validServiceKeyId(keyId: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(keyId)
}

function validWorkspaceId(workspaceId: string): boolean {
  return typeof workspaceId === 'string'
    && workspaceId.length > 0
    && workspaceId.length <= 256
    && !/[\u0000-\u001f\u007f]/.test(workspaceId)
}

function expectedRegionOrigin(region: string): string {
  return `https://${region}.okms.ovh.net`
}

function keyRef(region: string, serviceKeyId: string): string {
  return `ovh-kms:v1:${region}:${serviceKeyId}`
}

function validWorkspaceRoute(route: OvhKmsWorkspaceKeyRouteV1): boolean {
  return Boolean(
    route
    && validWorkspaceId(route.workspaceId)
    && validRegion(route.region)
    && validServiceKeyId(route.serviceKeyId)
    && route.endpointOrigin === expectedRegionOrigin(route.region)
    && Number.isSafeInteger(route.keyVersion)
    && route.keyVersion > 0
    && route.transport?.contractVersion === 'boring.ovh-kms-http-transport.v1',
  )
}

function validateContext(context: WorkspaceKekContextV1): void {
  if (
    !context
    || !validWorkspaceId(context.workspaceId)
    || typeof context.requestId !== 'string'
    || context.requestId.length === 0
    || context.requestId.length > 256
    || !Number.isSafeInteger(context.dekGeneration)
    || context.dekGeneration <= 0
  ) {
    throw unreadable()
  }
}

function strictBase64Decode(value: unknown, expectedBytes?: number): Buffer {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_OVH_KMS_WRAPPED_KEY_BYTES_V1 * 2
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw unreadable()
  }
  const decoded = Buffer.from(value, 'base64')
  const canonical = Buffer.from(decoded.toString('base64'), 'utf8')
  const supplied = Buffer.from(value, 'utf8')
  try {
    if (
      !constantTimeBytesEqualV1(canonical, supplied)
      || decoded.byteLength === 0
      || decoded.byteLength > MAX_OVH_KMS_WRAPPED_KEY_BYTES_V1
      || (expectedBytes !== undefined && decoded.byteLength !== expectedBytes)
    ) {
      decoded.fill(0)
      throw unreadable()
    }
    return decoded
  } finally {
    canonical.fill(0)
    supplied.fill(0)
  }
}

function rejectAllZeroDek(bytes: Buffer): void {
  let aggregate = 0
  for (const byte of bytes) aggregate |= byte
  if (aggregate === 0) {
    bytes.fill(0)
    throw unreadable()
  }
}

export function encodeOvhKmsOpaquePayloadV1(
  region: string,
  wrappedKey: Uint8Array,
): Uint8Array {
  if (
    !validRegion(region)
    || !(wrappedKey instanceof Uint8Array)
    || wrappedKey.byteLength === 0
    || wrappedKey.byteLength > MAX_OVH_KMS_WRAPPED_KEY_BYTES_V1
  ) {
    throw unreadable()
  }
  const regionBytes = Buffer.from(region, 'utf8')
  const output = Buffer.alloc(4 + 2 + regionBytes.byteLength + 4 + wrappedKey.byteLength)
  OVH_KMS_PAYLOAD_MAGIC_V1.copy(output, 0)
  output.writeUInt16BE(regionBytes.byteLength, 4)
  regionBytes.copy(output, 6)
  output.writeUInt32BE(wrappedKey.byteLength, 6 + regionBytes.byteLength)
  Buffer.from(wrappedKey).copy(output, 10 + regionBytes.byteLength)
  regionBytes.fill(0)
  return new Uint8Array(output)
}

export function decodeOvhKmsOpaquePayloadV1(
  payload: Uint8Array,
): Readonly<{ region: string; wrappedKey: Uint8Array }> {
  if (
    !(payload instanceof Uint8Array)
    || payload.byteLength < 11
    || payload.byteLength > MAX_OVH_KMS_WRAPPED_KEY_BYTES_V1 + 512
  ) {
    throw unreadable()
  }
  const buffer = Buffer.from(payload)
  if (!constantTimeBytesEqualV1(buffer.subarray(0, 4), OVH_KMS_PAYLOAD_MAGIC_V1)) {
    throw unreadable()
  }
  const regionLength = buffer.readUInt16BE(4)
  if (regionLength === 0 || regionLength > 255 || 10 + regionLength > buffer.byteLength) {
    throw unreadable()
  }
  const wrappedLength = buffer.readUInt32BE(6 + regionLength)
  if (
    wrappedLength === 0
    || wrappedLength > MAX_OVH_KMS_WRAPPED_KEY_BYTES_V1
    || 10 + regionLength + wrappedLength !== buffer.byteLength
  ) {
    throw unreadable()
  }
  const region = buffer.subarray(6, 6 + regionLength).toString('utf8')
  if (!validRegion(region)) throw unreadable()
  return {
    region,
    wrappedKey: new Uint8Array(buffer.subarray(10 + regionLength)),
  }
}

export function createOvhKmsMtlsHttpTransportV1(
  options: OvhKmsMtlsHttpTransportOptionsV1,
): OvhKmsHttpTransportV1 {
  const timeout = options.requestTimeoutMs ?? 10_000
  let reasonCode: string | undefined
  let endpointOrigin = ''
  try {
    const parsed = new URL(options.endpointOrigin)
    if (
      parsed.protocol !== 'https:'
      || parsed.origin !== options.endpointOrigin
      || parsed.username !== ''
      || parsed.password !== ''
    ) {
      reasonCode = 'OVH_KMS_ENDPOINT_INVALID'
    } else {
      endpointOrigin = parsed.origin
    }
  } catch {
    reasonCode = 'OVH_KMS_ENDPOINT_INVALID'
  }
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 60_000) {
    reasonCode = 'OVH_KMS_TIMEOUT_INVALID'
  }

  const certificate = readSealedHostFileV1(options.clientCertificatePath, {
    expectedOwnerUid: options.expectedOwnerUid,
    maximumBytes: MAX_OVH_KMS_MTLS_FILE_BYTES_V1,
  })
  const privateKey = readSealedHostFileV1(options.clientPrivateKeyPath, {
    expectedOwnerUid: options.expectedOwnerUid,
    maximumBytes: MAX_OVH_KMS_MTLS_FILE_BYTES_V1,
  })
  const caCertificate = options.caCertificatePath
    ? readSealedHostFileV1(options.caCertificatePath, {
        expectedOwnerUid: options.expectedOwnerUid,
        maximumBytes: MAX_OVH_KMS_MTLS_FILE_BYTES_V1,
      })
    : undefined
  if (!certificate.ok || !privateKey.ok || (caCertificate && !caCertificate.ok)) {
    reasonCode = 'OVH_KMS_MTLS_FILES_INVALID'
  }

  let agent: Agent | undefined
  if (!reasonCode && certificate.ok && privateKey.ok) {
    try {
      // Force PEM/key parsing during readiness construction. `https.Agent`
      // otherwise defers malformed mTLS material until the first live request.
      createSecureContext({
        cert: certificate.bytes,
        key: privateKey.bytes,
        ...(caCertificate?.ok ? { ca: caCertificate.bytes } : {}),
        minVersion: 'TLSv1.2',
      })
      agent = new Agent({
        cert: certificate.bytes,
        key: privateKey.bytes,
        ...(caCertificate?.ok ? { ca: caCertificate.bytes } : {}),
        keepAlive: true,
        maxSockets: 8,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
      })
    } catch {
      reasonCode = 'OVH_KMS_MTLS_INITIALIZATION_FAILED'
    }
  }
  if (reasonCode) {
    if (certificate.ok) certificate.bytes.fill(0)
    if (privateKey.ok) privateKey.bytes.fill(0)
    if (caCertificate?.ok) caCertificate.bytes.fill(0)
  }
  let closed = false

  return Object.freeze({
    contractVersion: 'boring.ovh-kms-http-transport.v1' as const,
    async readiness() {
      return closed || reasonCode || !agent
        ? {
            ready: false,
            reasonCode: closed ? 'OVH_KMS_TRANSPORT_CLOSED' : reasonCode,
          }
        : { ready: true }
    },
    async request(input: OvhKmsHttpRequestV1): Promise<OvhKmsHttpResponseV1> {
      if (closed || reasonCode || !agent) throw backendUnavailable()
      let url: URL
      try {
        url = new URL(input.url)
      } catch {
        throw backendUnavailable(false)
      }
      if (
        input.method !== 'POST'
        || url.origin !== endpointOrigin
        || url.username !== ''
        || url.password !== ''
        || url.hash !== ''
        || !(input.body instanceof Uint8Array)
        || input.body.byteLength > MAX_OVH_KMS_RESPONSE_BYTES_V1
      ) {
        throw backendUnavailable(false)
      }

      return new Promise<OvhKmsHttpResponseV1>((resolve, reject) => {
        let settled = false
        const chunks: Buffer[] = []
        let length = 0
        const wipeChunks = () => {
          for (const chunk of chunks) chunk.fill(0)
          chunks.length = 0
        }
        const fail = () => {
          if (settled) return
          settled = true
          wipeChunks()
          reject(backendUnavailable())
        }
        const request = httpsRequest(url, {
          method: 'POST',
          agent,
          headers: input.headers,
        }, (response) => {
          response.on('data', (chunk: Buffer) => {
            if (settled) {
              chunk.fill(0)
              return
            }
            length += chunk.byteLength
            if (length > MAX_OVH_KMS_RESPONSE_BYTES_V1) {
              chunk.fill(0)
              response.destroy()
              request.destroy()
              fail()
              return
            }
            chunks.push(chunk)
          })
          response.once('aborted', fail)
          response.once('error', fail)
          response.once('close', () => {
            if (!response.complete) fail()
          })
          response.once('end', () => {
            if (settled) return
            settled = true
            const combined = Buffer.concat(chunks)
            wipeChunks()
            try {
              resolve({
                status: response.statusCode ?? 0,
                body: Uint8Array.from(combined),
              })
            } finally {
              combined.fill(0)
            }
          })
        })
        const requestBody = Buffer.from(input.body)
        const wipeRequestBody = () => requestBody.fill(0)
        request.setTimeout(timeout, () => {
          request.destroy()
          fail()
        })
        request.once('error', fail)
        request.once('close', wipeRequestBody)
        request.end(requestBody, wipeRequestBody)
      })
    },
    async close(): Promise<void> {
      if (closed) return
      closed = true
      agent?.destroy()
      agent = undefined
      if (certificate.ok) certificate.bytes.fill(0)
      if (privateKey.ok) privateKey.bytes.fill(0)
      if (caCertificate?.ok) caCertificate.bytes.fill(0)
    },
  })
}

function parseJsonObject(body: Uint8Array): Record<string, unknown> {
  if (!(body instanceof Uint8Array) || body.byteLength > MAX_OVH_KMS_RESPONSE_BYTES_V1) {
    throw backendUnavailable()
  }
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw backendUnavailable()
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof CredentialResolutionError) throw error
    throw backendUnavailable()
  }
}

/** Immutable test/self-host registry; managed deployments may inject a dynamic resolver. */
export function createStaticOvhKmsWorkspaceKeyRouteResolverV1(
  configuredRoutes: readonly OvhKmsWorkspaceKeyRouteV1[],
): OvhKmsWorkspaceKeyRouteResolverV1 {
  const routes = new Map<string, Readonly<OvhKmsWorkspaceKeyRouteV1>>()
  const keyOwners = new Map<string, string>()
  const transports = new Set<OvhKmsHttpTransportV1>()
  let reasonCode: string | undefined
  if (!Array.isArray(configuredRoutes) || configuredRoutes.length === 0) {
    reasonCode = 'OVH_KMS_KEY_ROUTES_MISSING'
  } else {
    for (const candidate of configuredRoutes) {
      const candidateKeyRef = candidate
        ? keyRef(candidate.region, candidate.serviceKeyId)
        : ''
      if (
        !validWorkspaceRoute(candidate)
        || routes.has(candidate.workspaceId)
        || keyOwners.has(candidateKeyRef)
      ) {
        reasonCode = 'OVH_KMS_KEY_ROUTE_INVALID'
        routes.clear()
        keyOwners.clear()
        break
      }
      const route = Object.freeze({ ...candidate })
      routes.set(route.workspaceId, route)
      keyOwners.set(candidateKeyRef, route.workspaceId)
      transports.add(route.transport)
    }
  }
  let closed = false

  return Object.freeze({
    contractVersion: OVH_KMS_ROUTE_RESOLVER_VERSION_V1,
    async readiness() {
      if (closed || reasonCode) {
        return {
          ready: false,
          reasonCode: closed ? 'OVH_KMS_ROUTE_RESOLVER_CLOSED' : reasonCode,
        }
      }
      try {
        const results = await Promise.all(
          [...transports].map((transport) => transport.readiness()),
        )
        if (results.some((result) => result.ready)) return { ready: true }
        return {
          ready: false,
          reasonCode: results[0]?.reasonCode ?? 'OVH_KMS_TRANSPORT_NOT_READY',
        }
      } catch {
        return {
          ready: false,
          reasonCode: 'OVH_KMS_TRANSPORT_READINESS_FAILED',
        }
      }
    },
    async resolve(workspaceId: string) {
      if (closed || reasonCode || !validWorkspaceId(workspaceId)) return undefined
      return routes.get(workspaceId)
    },
    async close() {
      if (closed) return
      closed = true
      await Promise.allSettled(
        [...transports].map(
          (transport) => transport.close?.() ?? Promise.resolve(),
        ),
      )
    },
  })
}

// OWNER FOLLOW-UP: exercise this provider against an owner-controlled regional
// OVHcloud KMS endpoint with real mTLS material. This implementation bead uses
// only the transport contract and mock conformance tests; it records no live
// endpoint evidence.
export function createOvhKmsProviderV1(
  options: OvhKmsProviderOptionsV1,
): WorkspaceKekProviderV1 {
  const providerId = options.providerId ?? OVH_KMS_PROVIDER_ID_V1
  const routeResolver = options.workspaceKeyRouteResolver
  const resolvedWorkspaceKeyRefs = new Map<string, string>()
  const resolvedKeyOwners = new Map<string, string>()
  let configurationReason: string | undefined
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(providerId)) {
    configurationReason = 'OVH_KMS_PROVIDER_ID_INVALID'
  } else if (
    routeResolver?.contractVersion !== OVH_KMS_ROUTE_RESOLVER_VERSION_V1
  ) {
    configurationReason = 'OVH_KMS_ROUTE_RESOLVER_INVALID'
  }
  let closed = false

  async function readiness() {
    if (closed || configurationReason) {
      return {
        ready: false,
        reasonCode: closed ? 'OVH_KMS_PROVIDER_CLOSED' : configurationReason,
      }
    }
    try {
      const result = await routeResolver.readiness()
      return result.ready
        ? { ready: true }
        : {
            ready: false,
            reasonCode: result.reasonCode ?? 'OVH_KMS_ROUTE_RESOLVER_NOT_READY',
          }
    } catch {
      return { ready: false, reasonCode: 'OVH_KMS_ROUTE_RESOLVER_FAILED' }
    }
  }

  async function routeFor(
    context: WorkspaceKekContextV1,
  ): Promise<Readonly<OvhKmsWorkspaceKeyRouteV1>> {
    validateContext(context)
    if (closed || configurationReason) throw backendUnavailable()
    let resolved: OvhKmsWorkspaceKeyRouteV1 | undefined
    try {
      resolved = await routeResolver.resolve(context.workspaceId)
    } catch {
      throw backendUnavailable()
    }
    if (
      !resolved
      || !validWorkspaceRoute(resolved)
      || !constantTimeTextEqualV1(resolved.workspaceId, context.workspaceId)
    ) {
      throw backendUnavailable(false)
    }
    const resolvedKeyRef = keyRef(resolved.region, resolved.serviceKeyId)
    const priorWorkspaceKeyRef = resolvedWorkspaceKeyRefs.get(context.workspaceId)
    const priorKeyOwner = resolvedKeyOwners.get(resolvedKeyRef)
    if (
      (priorWorkspaceKeyRef
        && !constantTimeTextEqualV1(priorWorkspaceKeyRef, resolvedKeyRef))
      || (priorKeyOwner
        && !constantTimeTextEqualV1(priorKeyOwner, context.workspaceId))
    ) {
      throw backendUnavailable(false)
    }
    resolvedWorkspaceKeyRefs.set(context.workspaceId, resolvedKeyRef)
    resolvedKeyOwners.set(resolvedKeyRef, context.workspaceId)
    return Object.freeze({ ...resolved })
  }

  async function requireReady(
    route: Readonly<OvhKmsWorkspaceKeyRouteV1>,
  ): Promise<void> {
    try {
      if (!(await route.transport.readiness()).ready) throw backendUnavailable()
    } catch (error) {
      if (error instanceof CredentialResolutionError) throw error
      throw backendUnavailable()
    }
  }

  async function post(
    route: Readonly<OvhKmsWorkspaceKeyRouteV1>,
    path: string,
    body: Readonly<Record<string, string | number>>,
    decryptOperation: boolean,
  ): Promise<Record<string, unknown>> {
    await requireReady(route)
    const bodyBytes = Buffer.from(JSON.stringify(body), 'utf8')
    let response: OvhKmsHttpResponseV1
    try {
      response = await route.transport.request({
        method: 'POST',
        url: `${route.endpointOrigin}${path}`,
        headers: Object.freeze({
          accept: 'application/json',
          'content-type': 'application/json',
          'content-length': String(bodyBytes.byteLength),
        }),
        body: bodyBytes,
      })
    } catch (error) {
      if (error instanceof CredentialResolutionError) throw error
      throw backendUnavailable()
    } finally {
      bodyBytes.fill(0)
    }
    try {
      if (response.status < 200 || response.status >= 300) {
        if (decryptOperation && response.status >= 400 && response.status < 500) {
          throw unreadable()
        }
        throw backendUnavailable(response.status >= 500 || response.status === 0)
      }
      return parseJsonObject(response.body)
    } finally {
      response.body.fill(0)
    }
  }

  return Object.freeze({
    contractVersion: WORKSPACE_KEK_PROVIDER_VERSION,
    providerId,
    readiness,
    async generateDataKey(
      context: WorkspaceKekContextV1,
    ): Promise<GeneratedWorkspaceDekV1> {
      const route = await routeFor(context)
      const response = await post(
        route,
        `/v1/servicekey/${encodeURIComponent(route.serviceKeyId)}/datakey`,
        {
          name: `boring-workspace-dek-${context.dekGeneration}`,
          size: 256,
        },
        false,
      )
      const plaintext = strictBase64Decode(response.plaintext, 32)
      rejectAllZeroDek(plaintext)
      let wrappedKey: Buffer | undefined
      try {
        wrappedKey = strictBase64Decode(response.key)
        return {
          plaintextDek: Uint8Array.from(plaintext),
          wrappedDek: {
            providerId,
            keyRef: keyRef(route.region, route.serviceKeyId),
            keyVersion: route.keyVersion,
            payload: {
              format: 'external-kms-opaque.v1',
              payloadFormatId: OVH_KMS_PAYLOAD_FORMAT_V1,
              opaqueAuthenticatedPayload: encodeOvhKmsOpaquePayloadV1(
                route.region,
                wrappedKey,
              ),
            },
          },
        }
      } finally {
        plaintext.fill(0)
        wrappedKey?.fill(0)
      }
    },
    async unwrapDataKey(
      context: WorkspaceKekContextV1,
      wrapped: WrappedWorkspaceDekV1,
    ): Promise<Uint8Array> {
      const route = await routeFor(context)
      const configuredKeyRef = keyRef(route.region, route.serviceKeyId)
      if (
        !wrapped
        || typeof wrapped.providerId !== 'string'
        || typeof wrapped.keyRef !== 'string'
        || !wrapped.payload
        || wrapped.payload.format !== 'external-kms-opaque.v1'
        || typeof wrapped.payload.payloadFormatId !== 'string'
        || !(wrapped.payload.opaqueAuthenticatedPayload instanceof Uint8Array)
        || !constantTimeTextEqualV1(wrapped.providerId, providerId)
        || !constantTimeTextEqualV1(wrapped.keyRef, configuredKeyRef)
        || wrapped.keyVersion !== route.keyVersion
        || !constantTimeTextEqualV1(
          wrapped.payload.payloadFormatId,
          OVH_KMS_PAYLOAD_FORMAT_V1,
        )
      ) {
        throw unreadable()
      }
      const decoded = decodeOvhKmsOpaquePayloadV1(
        wrapped.payload.opaqueAuthenticatedPayload,
      )
      if (!constantTimeTextEqualV1(decoded.region, route.region)) throw unreadable()
      const wrappedKey = Buffer.from(decoded.wrappedKey)
      try {
        const response = await post(
          route,
          `/v1/servicekey/${encodeURIComponent(route.serviceKeyId)}/datakey/decrypt`,
          { key: wrappedKey.toString('base64') },
          true,
        )
        const plaintext = strictBase64Decode(response.plaintext, 32)
        rejectAllZeroDek(plaintext)
        try {
          return Uint8Array.from(plaintext)
        } finally {
          plaintext.fill(0)
        }
      } finally {
        wrappedKey.fill(0)
        decoded.wrappedKey.fill(0)
      }
    },
    async close(): Promise<void> {
      if (closed) return
      closed = true
      await routeResolver?.close?.()
    },
  })
}
