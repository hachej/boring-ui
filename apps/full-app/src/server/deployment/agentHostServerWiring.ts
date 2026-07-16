import path from 'node:path'

import { AgentEffectAdmissionError, type AgentEffectAdmission } from '@hachej/boring-agent/core'
import type { CoreFrontendRootHandler } from '@hachej/boring-core/app/server'
import type { CoreConfig } from '@hachej/boring-core/shared'
import type { CoreRequestScopeResolver } from '@hachej/boring-core/server'
import type { FastifyInstance } from 'fastify'

import { createAgentHostActiveCollectionReader, type AgentHostActiveCollectionReader } from './activeCollectionReader.js'
import type { AgentHostAdmissionLedger } from './admissionLedger.js'
import type { AgentHostServedCollectionAuthority } from './bootCollection.js'
import { createAgentHostLandingRootHandler } from './agentHostLanding.js'
import {
  createAgentHostAgentRuntimeIdentityResolver,
  createAgentHostAgentRuntimeRecipeResolver,
  type AgentHostAgentRuntimeIdentityResolver,
  type AgentHostAgentRuntimeRecipeResolver,
} from './agentHostAgentRuntimeRecipe.js'
import { AgentHostError, AgentHostErrorCode, invalidAgentHostField, strictAgentHostId } from './agentHostPlan.js'
import { registerAgentHostReadinessRoute } from './agentHostReadiness.js'
import type { AgentHostUserNeutralCandidatePreloader } from './agentHostUserNeutralPreloader.js'
import { createAgentHostSurfaceResolver, AGENT_HOST_TRUSTED_CADDY_PEER } from './hostSurface.js'

const APP_UID = 10001
const APP_GID = 10001
const MAX_LINUX_UID = 0xffff_fffe
const OWNER_UID_RE = /^(?:0|[1-9][0-9]*)$/

export interface AgentHostServerWiring {
  readonly requestScopeResolver: CoreRequestScopeResolver
  readonly frontendRootHandler: CoreFrontendRootHandler
  readonly admitAgentEffect: AgentEffectAdmission
  readonly resolveAgentRuntimeIdentity: AgentHostAgentRuntimeIdentityResolver
  readonly resolveAgentRuntimeRecipe: AgentHostAgentRuntimeRecipeResolver
  readonly candidatePreloader?: AgentHostUserNeutralCandidatePreloader
  registerReadiness(app: FastifyInstance): void
}

export interface AgentHostServerWiringDependencies {
  readonly admissionLedger?: Pick<AgentHostAdmissionLedger, 'admit'>
  readonly candidatePreloader?: AgentHostUserNeutralCandidatePreloader
  readonly servedCollection?: AgentHostServedCollectionAuthority
}

function admissionFailed(): AgentEffectAdmissionError {
  return new AgentEffectAdmissionError(AgentHostErrorCode.ADMISSION_RECORD_FAILED, { field: 'admission' })
}

export function createAgentHostAgentEffectAdmission(options: {
  readonly hostId: string
  readonly activeReader: AgentHostActiveCollectionReader
  readonly admissionLedger?: Pick<AgentHostAdmissionLedger, 'admit'>
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
    } catch (error) {
      if (error instanceof AgentHostError && error.code === AgentHostErrorCode.ADMISSION_IDENTITY_MISMATCH) {
        throw new AgentEffectAdmissionError(error.code, error.details)
      }
      throw admissionFailed()
    }
  }
}

function ownerUid(raw: string | undefined): number {
  if (raw === undefined || !OWNER_UID_RE.test(raw)) invalidAgentHostField('ownerUid')
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value > MAX_LINUX_UID || value === APP_UID) invalidAgentHostField('ownerUid')
  return value
}

export function createAgentHostServerWiring(
  config: CoreConfig,
  env: Record<string, string | undefined> = process.env,
  dependencies: AgentHostServerWiringDependencies = {},
): AgentHostServerWiring | undefined {
  if (env.BORING_AGENT_HOST_ID === undefined) return undefined
  const hostId = strictAgentHostId(env.BORING_AGENT_HOST_ID, 'hostId')
  const publicationOwnerUid = ownerUid(env.BORING_AGENT_HOST_OWNER_UID)
  if (process.geteuid?.() !== APP_UID) invalidAgentHostField('processUid')
  if (process.getegid?.() !== APP_GID) invalidAgentHostField('processGid')
  const proxy = config.security?.trustedProxy
  if (typeof proxy !== 'object' || proxy === null || proxy.hops !== 1 || !Array.isArray(proxy.cidrs)
    || proxy.cidrs.length !== 1 || proxy.cidrs[0] !== `${AGENT_HOST_TRUSTED_CADDY_PEER}/32`) invalidAgentHostField('trustedProxy')
  const diskReader = createAgentHostActiveCollectionReader({
    hostRoot: path.join('/var/lib/boring/agent-host', hostId), hostId,
    ownerUid: publicationOwnerUid, appGid: APP_GID,
  })
  const activeReader = dependencies.servedCollection ?? diskReader
  return Object.freeze({
    requestScopeResolver: createAgentHostSurfaceResolver({ activeReader, trustedPeer: AGENT_HOST_TRUSTED_CADDY_PEER }),
    frontendRootHandler: createAgentHostLandingRootHandler({ activeReader }),
    admitAgentEffect: createAgentHostAgentEffectAdmission({ hostId, activeReader, admissionLedger: dependencies.admissionLedger }),
    resolveAgentRuntimeIdentity: createAgentHostAgentRuntimeIdentityResolver(activeReader),
    resolveAgentRuntimeRecipe: createAgentHostAgentRuntimeRecipeResolver(diskReader, dependencies.servedCollection),
    ...(dependencies.candidatePreloader ? { candidatePreloader: dependencies.candidatePreloader } : {}),
    registerReadiness(app: FastifyInstance) { registerAgentHostReadinessRoute(app, { activeReader }) },
  })
}
