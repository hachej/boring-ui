import {
  assertAgentHostExactKeys,
  AgentHostError,
  AgentHostErrorCode,
  parseAgentHostPlan,
  type AgentHostPlanV1,
} from './agentHostPlan.js'
import {
  preflightAgentHostEdgeNetwork,
  type AgentHostProcess,
  type AgentHostResult,
  type AgentHostRunner,
} from './edgeNetworkPreflight.js'
import { AGENT_HOST_CADDY_IMAGE } from './agentHostIngressArtifacts.js'

export { AGENT_HOST_CADDY_IMAGE } from './agentHostIngressArtifacts.js'

const CONTROL_KEYS = ['schemaVersion', 'ingressImage', 'coreAppImage'] as const
const IMAGE_RE = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/
const COMPOSE_DIRECTORY = '/opt/boring/agent-host'
const COMPOSE_FILE = `${COMPOSE_DIRECTORY}/compose.yml`
const PROJECT_NAME = 'boring-agent-host'
const STATE_ROOT = '/var/lib/boring/agent-host'
const MATERIALIZED_ROOT = '/run/boring/agent-host'
const CONTROL_ROOT = '/run/boring/agent-host/control'

export type AgentHostComposeEffect = 'initial' | 'start-ingress' | 'no-compose' | 'restart-core'

export interface AgentHostComposeImagesV1 {
  readonly schemaVersion: 1
  readonly ingressImage: string
  readonly coreAppImage: string
}

export type AgentHostComposeProcess = AgentHostProcess
export type AgentHostComposeResult = AgentHostResult
export type AgentHostComposeRunner = AgentHostRunner

function invalid(field: string): never {
  throw new AgentHostError(AgentHostErrorCode.PLAN_INVALID, { field })
}

function pinnedImage(value: unknown, field: string): string {
  if (typeof value !== 'string' || !IMAGE_RE.test(value)) invalid(field)
  return value
}

function parseImages(raw: unknown, plan: AgentHostPlanV1): AgentHostComposeImagesV1 {
  assertAgentHostExactKeys(raw, CONTROL_KEYS, 'compose')
  if (raw.schemaVersion !== 1) invalid('compose.schemaVersion')
  const coreAppImage = pinnedImage(raw.coreAppImage, 'compose.coreAppImage')
  if (!coreAppImage.endsWith(`@${plan.hostAppImageDigest}`)) invalid('compose.coreAppImage')

  return Object.freeze({
    schemaVersion: 1,
    ingressImage: raw.ingressImage === AGENT_HOST_CADDY_IMAGE ? AGENT_HOST_CADDY_IMAGE : invalid('compose.ingressImage'),
    coreAppImage,
  })
}

function process(args: readonly string[], plan: AgentHostPlanV1, images: AgentHostComposeImagesV1): AgentHostComposeProcess {
  return Object.freeze({
    command: 'docker',
    args: Object.freeze([...args]),
    cwd: COMPOSE_DIRECTORY,
    env: Object.freeze({
      COMPOSE_DISABLE_ENV_FILE: '1',
      AGENT_HOST_CORE_APP_IMAGE: images.coreAppImage,
      AGENT_HOST_ID: plan.hostId,
      AGENT_HOST_INGRESS_IMAGE: images.ingressImage,
      AGENT_HOST_MATERIALIZED_HOST_ROOT: `${MATERIALIZED_ROOT}/${plan.hostId}`,
      AGENT_HOST_STATE_ROOT: `${STATE_ROOT}/${plan.hostId}`,
      AGENT_HOST_CONTROL_ROOT: CONTROL_ROOT,
    }),
    shell: false,
  })
}

export function renderAgentHostComposeCommands(effect: AgentHostComposeEffect, rawPlan: unknown, rawImages: unknown): readonly AgentHostComposeProcess[] {
  const plan = parseAgentHostPlan(rawPlan)
  const images = parseImages(rawImages, plan)
  const base = ['compose', '--file', COMPOSE_FILE, '--project-directory', COMPOSE_DIRECTORY, '--project-name', PROJECT_NAME]
  if (effect === 'initial') return Object.freeze([
    process([...base, 'run', '--rm', '--no-deps', 'core-app', 'node', 'apps/full-app/dist/server/migrate.js'], plan, images),
    process([...base, 'up', '-d', '--no-deps', 'core-app'], plan, images),
  ])
  if (effect === 'start-ingress') return Object.freeze([process([...base, 'up', '-d', '--no-deps', 'ingress'], plan, images)])
  if (effect === 'restart-core') {
    return Object.freeze([process([...base, 'up', '-d', '--no-deps', 'core-app'], plan, images)])
  }
  if (effect === 'no-compose') return Object.freeze([])
  return invalid('compose.effect')
}

export async function runAgentHostComposeAction(
  effect: AgentHostComposeEffect,
  rawPlan: unknown,
  rawImages: unknown,
  runner: AgentHostComposeRunner,
): Promise<void> {
  const commands = renderAgentHostComposeCommands(effect, rawPlan, rawImages)
  if (commands.length === 0) return
  await preflightAgentHostEdgeNetwork(runner)
  try {
    for (const command of commands) {
      const result = await runner(command)
      if (result.exitCode !== 0) throw new Error('compose failed')
    }
  } catch {
    throw new AgentHostError(AgentHostErrorCode.COLLECTION_NOT_READY, { field: 'compose' })
  }
}
