import {
  assertAgentHostExactKeys,
  AgentHostError,
  AgentHostErrorCode,
  parseAgentHostPlan,
  type AgentHostPlanV1,
} from './agentHostPlan.js'
import type { AgentHostAuthorityDescriptorV1 } from './agentHostAuthority.js'
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
const DEFAULT_COMPOSE_DIRECTORY = '/opt/boring/agent-host'
const DEFAULT_PROJECT_NAME = 'boring-agent-host'
const DEFAULT_STATE_ROOT = '/var/lib/boring/agent-host'
const DEFAULT_MATERIALIZED_ROOT = '/run/boring/agent-host'
const DEFAULT_CONTROL_ROOT = '/run/boring/agent-host/control'
const CONTAINER_ID_RE = /^[a-f0-9]{64}$/

export type AgentHostComposeEffect = 'initial' | 'start-ingress' | 'no-compose' | 'restart-core' | 'status' | 'cleanup'

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
function failed(): never {
  throw new AgentHostError(AgentHostErrorCode.COLLECTION_NOT_READY, { field: 'compose' })
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
function descriptorFor(plan: AgentHostPlanV1, authority?: AgentHostAuthorityDescriptorV1): AgentHostAuthorityDescriptorV1 | undefined {
  if (!authority) return undefined
  if (authority.hostId !== plan.hostId) invalid('authority')
  if (authority.mode === 'isolated-proof' && (plan.databaseRef !== authority.databaseRef || plan.runtimeProfileRef !== authority.runtimeProfile.ref)) invalid('authority')
  return authority
}
function composeBase(authority?: AgentHostAuthorityDescriptorV1): readonly string[] {
  const directory = authority?.configRoot ?? DEFAULT_COMPOSE_DIRECTORY
  const base = ['compose', '--file', `${directory}/compose.yml`]
  if (authority?.mode === 'isolated-proof') base.push('--file', `${directory}/compose.isolated.yml`)
  base.push('--project-directory', directory, '--project-name', authority?.composeProject ?? DEFAULT_PROJECT_NAME)
  return Object.freeze(base)
}
function process(args: readonly string[], plan: AgentHostPlanV1, images: AgentHostComposeImagesV1, authority?: AgentHostAuthorityDescriptorV1): AgentHostComposeProcess {
  const directory = authority?.configRoot ?? DEFAULT_COMPOSE_DIRECTORY
  const stateRoot = authority?.stateRoot ?? DEFAULT_STATE_ROOT
  const materializedRoot = authority?.materializedRoot ?? DEFAULT_MATERIALIZED_ROOT
  const controlRoot = authority?.controlRoot ?? DEFAULT_CONTROL_ROOT
  return Object.freeze({
    command: 'docker', args: Object.freeze([...args]), cwd: directory,
    env: Object.freeze({
      COMPOSE_DISABLE_ENV_FILE: '1', AGENT_HOST_CORE_APP_IMAGE: images.coreAppImage, AGENT_HOST_ID: plan.hostId,
      AGENT_HOST_INGRESS_IMAGE: images.ingressImage, AGENT_HOST_MATERIALIZED_HOST_ROOT: `${materializedRoot}/${plan.hostId}`,
      AGENT_HOST_STATE_ROOT: `${stateRoot}/${plan.hostId}`, AGENT_HOST_CONTROL_ROOT: controlRoot,
      ...(authority?.mode === 'isolated-proof' ? {
        AGENT_HOST_CORE_ENV_FILE: `${authority.configRoot}/core.env`,
        AGENT_HOST_WORKSPACE_ROOT: authority.workspaceRoot,
        AGENT_HOST_SESSION_ROOT: authority.sessionRoot,
        AGENT_HOST_SECRET_ROOT: authority.secretRoot,
        AGENT_HOST_CONTAINER_RUNTIME: authority.runtimeProfile.composeRuntime,
      } : {}),
    }),
    shell: false,
  })
}

export function renderAgentHostComposeCommands(
  effect: AgentHostComposeEffect,
  rawPlan: unknown,
  rawImages: unknown,
  authority?: AgentHostAuthorityDescriptorV1,
): readonly AgentHostComposeProcess[] {
  const plan = parseAgentHostPlan(rawPlan); const images = parseImages(rawImages, plan); const selected = descriptorFor(plan, authority)
  const base = composeBase(selected)
  if (effect === 'initial') return Object.freeze([
    process([...base, 'run', '--rm', '--no-deps', 'core-app', 'node', 'apps/full-app/dist/server/migrate.js'], plan, images, selected),
    process([...base, 'up', '-d', '--no-deps', 'core-app'], plan, images, selected),
  ])
  if (effect === 'start-ingress') return Object.freeze([process([...base, 'up', '-d', '--no-deps', 'ingress'], plan, images, selected)])
  if (effect === 'restart-core') return Object.freeze([process([...base, 'up', '-d', '--no-deps', 'core-app'], plan, images, selected)])
  if (effect === 'status') return Object.freeze([process([...base, 'ps'], plan, images, selected)])
  if (effect === 'cleanup') {
    if (selected?.mode !== 'isolated-proof') return invalid('compose.effect')
    return Object.freeze([process([...base, 'down', '--volumes', '--remove-orphans'], plan, images, selected)])
  }
  if (effect === 'no-compose') return Object.freeze([])
  return invalid('compose.effect')
}
function strictOutput(result: AgentHostComposeResult, maxBytes: number): string {
  if (result.exitCode !== 0 || typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > maxBytes) failed()
  return result.stdout
}
async function verifyEffectiveRuntime(
  service: 'core-app' | 'ingress',
  plan: AgentHostPlanV1,
  images: AgentHostComposeImagesV1,
  authority: AgentHostAuthorityDescriptorV1,
  runner: AgentHostComposeRunner,
): Promise<void> {
  if (authority.mode !== 'isolated-proof') return
  const base = composeBase(authority)
  const id = strictOutput(await runner(process([...base, 'ps', '--quiet', service], plan, images, authority)), 256).trim()
  if (!CONTAINER_ID_RE.test(id)) failed()
  const format = '{{json .HostConfig.Runtime}} {{json (index .Config.Labels "com.docker.compose.project")}} {{json (index .Config.Labels "com.docker.compose.service")}}'
  const raw = strictOutput(await runner(process(['inspect', '--format', format, id], plan, images, authority)), 1024).trim()
  let values: unknown[]
  try { values = JSON.parse(`[${raw.replaceAll(' ', ',')}]`) as unknown[] } catch { return failed() }
  if (values.length !== 3 || values[0] !== authority.runtimeProfile.composeRuntime || values[1] !== authority.composeProject || values[2] !== service) failed()
}

export async function runAgentHostComposeAction(
  effect: AgentHostComposeEffect,
  rawPlan: unknown,
  rawImages: unknown,
  runner: AgentHostComposeRunner,
  authority?: AgentHostAuthorityDescriptorV1,
): Promise<void> {
  const plan = parseAgentHostPlan(rawPlan); const images = parseImages(rawImages, plan); const selected = descriptorFor(plan, authority)
  const commands = renderAgentHostComposeCommands(effect, plan, images, selected)
  if (commands.length === 0) return
  if (effect !== 'status' && effect !== 'cleanup') await preflightAgentHostEdgeNetwork(runner, {
    composeDirectory: selected?.configRoot ?? DEFAULT_COMPOSE_DIRECTORY,
    projectName: selected?.composeProject ?? DEFAULT_PROJECT_NAME,
  })
  try {
    for (const command of commands) {
      const result = await runner(command)
      if (result.exitCode !== 0) throw new Error('compose failed')
    }
    if (selected?.mode === 'isolated-proof' && (effect === 'initial' || effect === 'restart-core')) await verifyEffectiveRuntime('core-app', plan, images, selected, runner)
    if (selected?.mode === 'isolated-proof' && effect === 'start-ingress') await verifyEffectiveRuntime('ingress', plan, images, selected, runner)
  } catch (error) {
    if (error instanceof AgentHostError) throw error
    failed()
  }
}
