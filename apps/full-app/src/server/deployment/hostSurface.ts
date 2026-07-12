import { isIP } from 'node:net'

import { ERROR_CODES, HttpError } from '@hachej/boring-core/shared'
import type { CoreRequestScopeResolver } from '@hachej/boring-core/server'

import type { D1ActiveCollectionReader } from './activeCollectionReader.js'
import { D1HostErrorCode, invalidD1Field, strictD1Hostname } from './d1Plan.js'

export const D1_TRUSTED_CADDY_PEER = '192.168.255.250'

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

export function createD1HostSurfaceResolver(options: D1HostSurfaceOptions): CoreRequestScopeResolver {
  if (options.trustedPeer !== D1_TRUSTED_CADDY_PEER) invalidD1Field('trustedPeer')
  return async (request) => {
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
    return Object.freeze({
      bindingId: binding.bindingId,
      workspaceId: binding.workspaceId,
      defaultDeploymentId: binding.defaultDeploymentId,
      activeRevision: collection.active.revisionId,
    })
  }
}
