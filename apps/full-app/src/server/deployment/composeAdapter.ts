import {
  assertD1ExactKeys,
  D1HostError,
  D1HostErrorCode,
  parseD1HostPlan,
  type D1HostPlanV1,
} from './d1Plan.js'
import {
  preflightD1EdgeNetwork,
  type D1HostProcess,
  type D1HostResult,
  type D1HostRunner,
} from './edgeNetworkPreflight.js'

const CONTROL_KEYS = ['schemaVersion', 'ingressImage', 'coreAppImage'] as const
const IMAGE_RE = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/
export const D1_CADDY_IMAGE = 'caddy@sha256:af5fdcd76f2db5e4e974ee92f96ee8c0fc3edb55bd4ba5032547cbf3f65e486d'
const COMPOSE_DIRECTORY = '/opt/boring/d1'
const COMPOSE_FILE = `${COMPOSE_DIRECTORY}/compose.yml`
const PROJECT_NAME = 'boring-d1'
const STATE_ROOT = '/var/lib/boring/d1'
const MATERIALIZED_ROOT = '/run/boring/d1'

export type D1ComposeEffect = 'initial' | 'no-compose' | 'restart-core'

export interface D1ComposeImagesV1 {
  readonly schemaVersion: 1
  readonly ingressImage: string
  readonly coreAppImage: string
}

export type D1ComposeProcess = D1HostProcess
export type D1ComposeResult = D1HostResult
export type D1ComposeRunner = D1HostRunner

function invalid(field: string): never {
  throw new D1HostError(D1HostErrorCode.PLAN_INVALID, { field })
}

function pinnedImage(value: unknown, field: string): string {
  if (typeof value !== 'string' || !IMAGE_RE.test(value)) invalid(field)
  return value
}

function parseImages(raw: unknown, plan: D1HostPlanV1): D1ComposeImagesV1 {
  assertD1ExactKeys(raw, CONTROL_KEYS, 'compose')
  if (raw.schemaVersion !== 1) invalid('compose.schemaVersion')
  const coreAppImage = pinnedImage(raw.coreAppImage, 'compose.coreAppImage')
  if (!coreAppImage.endsWith(`@${plan.hostAppImageDigest}`)) invalid('compose.coreAppImage')

  return Object.freeze({
    schemaVersion: 1,
    ingressImage: raw.ingressImage === D1_CADDY_IMAGE ? D1_CADDY_IMAGE : invalid('compose.ingressImage'),
    coreAppImage,
  })
}

function process(args: readonly string[], plan: D1HostPlanV1, images: D1ComposeImagesV1): D1ComposeProcess {
  return Object.freeze({
    command: 'docker',
    args: Object.freeze([...args]),
    cwd: COMPOSE_DIRECTORY,
    env: Object.freeze({
      COMPOSE_DISABLE_ENV_FILE: '1',
      D1_CORE_APP_IMAGE: images.coreAppImage,
      D1_HOST_ID: plan.hostId,
      D1_INGRESS_IMAGE: images.ingressImage,
      D1_MATERIALIZED_HOST_ROOT: `${MATERIALIZED_ROOT}/${plan.hostId}`,
      D1_STATE_ROOT: `${STATE_ROOT}/${plan.hostId}`,
    }),
    shell: false,
  })
}

export function renderD1ComposeCommands(effect: D1ComposeEffect, rawPlan: unknown, rawImages: unknown): readonly D1ComposeProcess[] {
  const plan = parseD1HostPlan(rawPlan)
  const images = parseImages(rawImages, plan)
  const base = ['compose', '--file', COMPOSE_FILE, '--project-directory', COMPOSE_DIRECTORY, '--project-name', PROJECT_NAME]
  if (effect === 'initial') return Object.freeze([
    process([...base, 'run', '--rm', '--no-deps', 'core-app', 'node', 'apps/full-app/dist/server/migrate.js'], plan, images),
    process([...base, 'up', '-d'], plan, images),
  ])
  if (effect === 'restart-core') {
    return Object.freeze([process([...base, 'up', '-d', '--no-deps', 'core-app'], plan, images)])
  }
  if (effect === 'no-compose') return Object.freeze([])
  return invalid('compose.effect')
}

export async function runD1ComposeAction(
  effect: D1ComposeEffect,
  rawPlan: unknown,
  rawImages: unknown,
  runner: D1ComposeRunner,
): Promise<void> {
  const commands = renderD1ComposeCommands(effect, rawPlan, rawImages)
  if (commands.length === 0) return
  await preflightD1EdgeNetwork(runner)
  try {
    for (const command of commands) {
      const result = await runner(command)
      if (result.exitCode !== 0) throw new Error('compose failed')
    }
  } catch {
    throw new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field: 'compose' })
  }
}
