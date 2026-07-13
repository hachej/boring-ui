import path from 'node:path'

import { AgentEffectAdmissionError, type AgentEffectAdmission } from '@hachej/boring-agent/core'
import type { CoreFrontendRootHandler } from '@hachej/boring-core/app/server'
import type { CoreConfig } from '@hachej/boring-core/shared'
import type { CoreRequestScopeResolver } from '@hachej/boring-core/server'
import type { FastifyInstance } from 'fastify'

import { createD1ActiveCollectionReader, type D1ActiveCollectionReader } from './activeCollectionReader.js'
import type { D1AdmissionLedger } from './admissionLedger.js'
import { createD1LandingRootHandler } from './d1Landing.js'
import { D1HostErrorCode, invalidD1Field, strictD1HostId } from './d1Plan.js'
import { registerD1ReadinessRoute } from './d1Readiness.js'
import { createD1HostSurfaceResolver, D1_TRUSTED_CADDY_PEER } from './hostSurface.js'

const APP_UID = 10001
const APP_GID = 10001
const MAX_LINUX_UID = 0xffff_fffe
const OWNER_UID_RE = /^(?:0|[1-9][0-9]*)$/

export interface D1ServerWiring {
  readonly requestScopeResolver: CoreRequestScopeResolver
  readonly frontendRootHandler: CoreFrontendRootHandler
  readonly admitAgentEffect: AgentEffectAdmission
  registerReadiness(app: FastifyInstance): void
}

export interface D1ServerWiringDependencies {
  readonly admissionLedger?: Pick<D1AdmissionLedger, 'admit'>
}

function admissionFailed(): AgentEffectAdmissionError {
  return new AgentEffectAdmissionError(D1HostErrorCode.ADMISSION_RECORD_FAILED, { field: 'admission' })
}

export function createD1AgentEffectAdmission(options: {
  readonly hostId: string
  readonly activeReader: D1ActiveCollectionReader
  readonly admissionLedger?: Pick<D1AdmissionLedger, 'admit'>
}): AgentEffectAdmission {
  return async ({ workspaceId }) => {
    try {
      if (!workspaceId || !options.admissionLedger) throw admissionFailed()
      const active = await options.activeReader.read()
      const matches = active?.desired.plan.bindings.filter((binding) => binding.workspaceId === workspaceId) ?? []
      if (!active || active.desired.plan.hostId !== options.hostId || matches.length !== 1) throw admissionFailed()
      const [binding] = matches
      await options.admissionLedger.admit(options.activeReader, {
        hostId: options.hostId,
        bindingId: binding!.bindingId,
        workspaceId,
        defaultDeploymentId: binding!.defaultDeploymentId,
      })
    } catch {
      throw admissionFailed()
    }
  }
}

function ownerUid(raw: string | undefined): number {
  if (raw === undefined || !OWNER_UID_RE.test(raw)) invalidD1Field('ownerUid')
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value > MAX_LINUX_UID || value === APP_UID) invalidD1Field('ownerUid')
  return value
}

export function createD1ServerWiring(
  config: CoreConfig,
  env: Record<string, string | undefined> = process.env,
  dependencies: D1ServerWiringDependencies = {},
): D1ServerWiring | undefined {
  if (env.BORING_D1_HOST_ID === undefined) return undefined
  const hostId = strictD1HostId(env.BORING_D1_HOST_ID, 'hostId')
  const publicationOwnerUid = ownerUid(env.BORING_D1_OWNER_UID)
  if (process.geteuid?.() !== APP_UID) invalidD1Field('processUid')
  if (process.getegid?.() !== APP_GID) invalidD1Field('processGid')
  const proxy = config.security?.trustedProxy
  if (typeof proxy !== 'object' || proxy === null || proxy.hops !== 1 || !Array.isArray(proxy.cidrs)
    || proxy.cidrs.length !== 1 || proxy.cidrs[0] !== `${D1_TRUSTED_CADDY_PEER}/32`) invalidD1Field('trustedProxy')
  const activeReader = createD1ActiveCollectionReader({
    hostRoot: path.join('/var/lib/boring/d1', hostId), hostId,
    ownerUid: publicationOwnerUid, appGid: APP_GID,
  })
  return Object.freeze({
    requestScopeResolver: createD1HostSurfaceResolver({ activeReader, trustedPeer: D1_TRUSTED_CADDY_PEER }),
    frontendRootHandler: createD1LandingRootHandler({ activeReader }),
    admitAgentEffect: createD1AgentEffectAdmission({ hostId, activeReader, admissionLedger: dependencies.admissionLedger }),
    registerReadiness(app: FastifyInstance) { registerD1ReadinessRoute(app, { activeReader }) },
  })
}
