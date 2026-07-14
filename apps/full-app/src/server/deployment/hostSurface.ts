import { isIP } from 'node:net'

import { ERROR_CODES, HttpError } from '@hachej/boring-core/shared'
import type { CoreRequestScopeResolver } from '@hachej/boring-core/server'

import type { D1ActiveCollectionReader } from './activeCollectionReader.js'
import { D1HostErrorCode, invalidD1Field, strictD1Hostname } from './d1Plan.js'

export const D1_TRUSTED_CADDY_PEER = '192.168.255.250'
const LOOPBACK = '127.0.0.1'
const LOCAL_PATHS = new Set(['/health', '/internal/d1/readiness'])

export interface D1HostSurfaceOptions {
  readonly activeReader: D1ActiveCollectionReader
  readonly trustedPeer: string
}

function violation(): never {
  throw new HttpError({
    status: 421,
    code: ERROR_CODES.D1_HOST_SCOPE_VIOLATION,
    message: D1HostErrorCode.HOST_SCOPE_VIOLATION,
  })
}

function rawValues(rawHeaders: readonly string[], name: string): readonly string[] {
  if (rawHeaders.length % 2 !== 0) violation()
  const values: string[] = []
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]!.toLowerCase() === name) values.push(rawHeaders[index + 1]!)
  }
  return values
}

function hasForwardingHeader(rawHeaders: readonly string[]): boolean {
  if (rawHeaders.length % 2 !== 0) violation()
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index]!.toLowerCase()
    if (name === 'forwarded' || name.startsWith('x-forwarded-')) return true
  }
  return false
}

function isLocalSurfaceAttempt(rawUrl: string | undefined): boolean {
  if (rawUrl === undefined) return false
  let decoded = rawUrl.split('?', 1)[0]!
  const matches = (value: string) => [...LOCAL_PATHS]
    .some((pathname) => value.startsWith(pathname) || value.endsWith(pathname))
  for (let depth = 0; depth < 4; depth += 1) {
    if (matches(decoded)) return true
    if (!decoded.includes('%')) return false
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) return true
      decoded = next
    } catch { return true }
  }
  return decoded.includes('%') || matches(decoded)
}

export function createD1HostSurfaceResolver(options: D1HostSurfaceOptions): CoreRequestScopeResolver {
  if (options.trustedPeer !== D1_TRUSTED_CADDY_PEER) invalidD1Field('trustedPeer')
  return async (request) => {
    const rawUrl = request.raw.url
    if (
      request.raw.socket.remoteAddress === LOOPBACK
      && request.raw.method === 'GET'
      && rawUrl !== undefined
      && LOCAL_PATHS.has(rawUrl)
    ) {
      if (hasForwardingHeader(request.raw.rawHeaders)) violation()
      return undefined
    }
    if (isLocalSurfaceAttempt(rawUrl)) violation()
    const forwarded = rawValues(request.raw.rawHeaders, 'forwarded')
    const hosts = rawValues(request.raw.rawHeaders, 'host')
    const forwardedFor = rawValues(request.raw.rawHeaders, 'x-forwarded-for')
    const forwardedHosts = rawValues(request.raw.rawHeaders, 'x-forwarded-host')
    if (forwarded.length !== 0 || hosts.length !== 1) violation()
    const peer = request.raw.socket.remoteAddress
    const ips = request.ips
    if (!ips) violation()
    let authority: string
    if (peer === options.trustedPeer) {
      if (
        ips.length !== 2
        || ips[0] !== options.trustedPeer
        || forwardedFor.length !== 1
        || isIP(forwardedFor[0]!) === 0
        || forwardedFor[0] !== forwardedFor[0]!.trim()
        || forwardedFor[0] !== ips[1]
        || forwardedHosts.length !== 1
        || hosts[0] !== forwardedHosts[0]
      ) violation()
      authority = forwardedHosts[0]!
    } else {
      if (
        typeof peer !== 'string'
        || ips.length !== 1
        || ips[0] !== peer
        || forwardedFor.length !== 0
        || forwardedHosts.length !== 0
      ) violation()
      authority = hosts[0]!
    }
    try {
      strictD1Hostname(authority, 'hostname')
    } catch {
      violation()
    }
    let collection
    try {
      collection = await options.activeReader.read()
    } catch {
      violation()
    }
    if (!collection) violation()
    const matches = collection.desired.plan.bindings.filter((binding) => binding.hostname === authority)
    if (matches.length !== 1) violation()
    const binding = matches[0]!
    const resolved = collection.desired.resolvedBindings.filter((value) => value.bindingId === binding.bindingId)
    if (resolved.length !== 1) violation()
    return Object.freeze({
      bindingId: binding.bindingId,
      workspaceId: binding.workspaceId,
      defaultDeploymentId: binding.defaultDeploymentId,
      activeRevision: collection.active.revisionId,
      resolvedDigest: resolved[0]!.resolvedDigest,
    })
  }
}
