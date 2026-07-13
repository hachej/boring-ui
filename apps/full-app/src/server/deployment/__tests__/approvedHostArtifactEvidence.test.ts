import { describe, expect, it } from 'vitest'

import { createD1ApprovedHostArtifactEvidence } from '../approvedHostArtifactEvidence.js'
import {
  D1_CADDY_AMD64_ID,
  D1_CADDY_COMMAND,
  D1_CADDY_IMAGE,
  D1_CADDY_IMAGE_DEFAULTS,
  D1_CADDYFILE_DIGEST,
} from '../d1IngressArtifacts.js'
import { D1HostError, D1HostErrorCode } from '../d1Plan.js'

const CANARY = 'artifact-evidence-canary-never-leaks'
const digest = (character: string) => `sha256:${character.repeat(64)}`
const revision = (character: string) => character.repeat(40)
const CORE_DIGEST = digest('a')
const CORE_REF = `ghcr.io/hachej/boring-ui@${CORE_DIGEST}`
const CORE_ID = digest('f')
const CADDY_BYTES = new TextEncoder().encode(':8080 {\n\treverse_proxy core-app:3000 {\n\t\theader_up -Forwarded\n\t\theader_up Host {hostport}\n\t\theader_up X-Forwarded-Host {hostport}\n\t}\n}\n')

const release = () => ({
  schemaVersion: 1,
  domain: 'boring-d1-approved-host-release:v1',
  hostAppImageDigest: CORE_DIGEST,
  coreCommand: { entrypoint: ['/usr/local/bin/web-entrypoint'], cmd: ['node', 'apps/full-app/dist/server/main.js'] },
  migrationProcess: { entrypoint: ['node'], cmd: ['apps/full-app/dist/server/migrate.js'], user: '10001:10001',
    readonlyRootfs: true, privileged: false, noNewPrivileges: true, addedCapabilities: [] },
  ingressImageDigest: D1_CADDY_IMAGE.split('@')[1],
  ingressCommand: { entrypoint: null, cmd: [...D1_CADDY_COMMAND] },
  caddyfileDigest: D1_CADDYFILE_DIGEST,
  hostSecurityConfigDigest: digest('d'),
  selectorInventoryRevision: revision('a'),
  executionPolicyRevision: revision('b'),
  databaseSchemaCompatibility: { migrationSetDigest: digest('e'), currentEpoch: 2,
    readableEpochRange: { min: 1, max: 2 }, readableByPreviousRelease: true },
})

const coreImage = () => [{
  Id: CORE_ID,
  RepoDigests: [CORE_REF],
  Architecture: 'amd64',
  Os: 'linux',
  Config: {
    Entrypoint: ['/usr/local/bin/web-entrypoint'],
    Cmd: ['node', 'apps/full-app/dist/server/main.js'],
    WorkingDir: '/app',
    Env: [
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      'NODE_VERSION=22.23.1',
      'YARN_VERSION=1.22.22',
      'NODE_ENV=production',
      'BORING_AGENT_MODE=vercel-sandbox',
      'BORING_AGENT_WORKSPACE_ROOT=/data/workspaces',
      'BORING_AGENT_SESSION_ROOT=/data/pi-sessions',
    ],
    Labels: {
      'boring.role': 'web',
      'org.opencontainers.image.revision': revision('b'),
      'ai.senecapp.d1.migration-set-digest': digest('e'),
      'ai.senecapp.d1.database-current-epoch': '2',
      'org.opencontainers.image.title': 'boring-ui full-app',
    },
  },
  RepoTags: ['ignored:latest'],
}]

const ingressImage = () => [{
  Id: D1_CADDY_AMD64_ID,
  RepoDigests: [
    `caddy@${digest('9')}`,
    D1_CADDY_IMAGE,
  ],
  Architecture: 'amd64',
  Os: 'linux',
  Config: {
    Cmd: [...D1_CADDY_COMMAND],
    WorkingDir: '/srv',
    Env: Object.entries(D1_CADDY_IMAGE_DEFAULTS).map(([key, value]) => `${key}=${value}`),
    Labels: { 'org.opencontainers.image.version': 'v2.11.4' },
  },
}]

type Field = 'approvedHostRelease' | 'coreImage' | 'ingressImage' | 'caddyfile' | 'databaseSchemaCompatibility'

function create(
  recordValue: unknown = release(),
  coreRef: unknown = CORE_REF,
  coreInspect: unknown = coreImage(),
  ingressInspect: unknown = ingressImage(),
  bytes: unknown = CADDY_BYTES.slice(),
) {
  return createD1ApprovedHostArtifactEvidence(recordValue as never, coreRef, coreInspect, ingressInspect, bytes)
}

function expectUnavailable(field: Field, action: () => unknown): Error {
  let failure: unknown
  try { action(); throw new Error('accepted invalid evidence') } catch (error) { failure = error }
  expect(failure).toMatchObject({ code: D1HostErrorCode.COLLECTION_NOT_READY, details: { field } })
  expect(String(failure)).not.toContain(CANARY)
  expect(JSON.stringify(failure)).not.toContain(CANARY)
  return failure as Error
}

function deeplyFrozen(value: unknown): boolean {
  return !value || typeof value !== 'object' || (Object.isFrozen(value) && Object.values(value).every(deeplyFrozen))
}

describe('D1 approved host artifact evidence', () => {
  it('projects actual pinned Dockerfile and Caddy artifacts into minimal deeply frozen evidence', () => {
    const result = create()
    expect(result).toEqual({
      coreImageId: CORE_ID,
      ingressImageId: D1_CADDY_AMD64_ID,
      imageDefaults: {
        path: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        nodeVersion: '22.23.1',
        yarnVersion: '1.22.22',
      },
      executionPolicyRevision: revision('b'),
      migrationSetDigest: digest('e'),
      currentEpoch: 2,
      caddyfileDigest: D1_CADDYFILE_DIGEST,
    })
    expect(Object.keys(result).sort()).toEqual([
      'caddyfileDigest', 'coreImageId', 'currentEpoch', 'executionPolicyRevision', 'imageDefaults',
      'ingressImageId', 'migrationSetDigest',
    ])
    expect(deeplyFrozen(result)).toBe(true)
  })

  it.each([
    ['host digest', 'coreImage', (value: any) => { value.hostAppImageDigest = digest('1') }],
    ['core command', 'approvedHostRelease', (value: any) => { value.coreCommand.cmd = ['node', 'other.js'] }],
    ['ingress digest', 'ingressImage', (value: any) => { value.ingressImageDigest = digest('2') }],
    ['ingress command', 'approvedHostRelease', (value: any) => { value.ingressCommand.cmd = ['caddy', 'reverse-proxy'] }],
    ['Caddyfile digest', 'caddyfile', (value: any) => { value.caddyfileDigest = digest('3') }],
    ['execution revision', 'coreImage', (value: any) => { value.executionPolicyRevision = revision('c') }],
    ['migration digest', 'databaseSchemaCompatibility', (value: any) => { value.databaseSchemaCompatibility.migrationSetDigest = digest('4') }],
    ['migration epoch', 'databaseSchemaCompatibility', (value: any) => { value.databaseSchemaCompatibility.currentEpoch = 3; value.databaseSchemaCompatibility.readableEpochRange.max = 3 }],
  ] as const)('rejects record %s drift', (_name, field, mutate) => {
    const value: any = release(); mutate(value)
    expectUnavailable(field, () => create(value))
  })

  it.each([
    ['image id', (value: any) => { value[0].Id = digest('z') }],
    ['repository digest', (value: any) => { value[0].RepoDigests = [`other@${CORE_DIGEST}`] }],
    ['architecture', (value: any) => { value[0].Architecture = 'arm64' }],
    ['OS', (value: any) => { value[0].Os = 'windows' }],
    ['entrypoint', (value: any) => { value[0].Config.Entrypoint = ['node'] }],
    ['command', (value: any) => { value[0].Config.Cmd = ['node', 'other.js'] }],
    ['working directory', (value: any) => { value[0].Config.WorkingDir = '/tmp' }],
    ['image user', (value: any) => { value[0].Config.User = '10001:10001' }],
    ['role label', (value: any) => { value[0].Config.Labels['boring.role'] = 'worker' }],
    ['revision label', (value: any) => { value[0].Config.Labels['org.opencontainers.image.revision'] = revision('c') }],
  ] as const)('rejects core %s drift', (_name, mutate) => {
    const value: any = coreImage(); mutate(value)
    expectUnavailable('coreImage', () => create(release(), CORE_REF, value))
  })

  it.each([
    ['migration digest label', (value: any) => { value[0].Config.Labels['ai.senecapp.d1.migration-set-digest'] = digest('1') }],
    ['migration epoch label', (value: any) => { value[0].Config.Labels['ai.senecapp.d1.database-current-epoch'] = '3' }],
  ] as const)('rejects core %s as database compatibility drift', (_name, mutate) => {
    const value: any = coreImage(); mutate(value)
    expectUnavailable('databaseSchemaCompatibility', () => create(release(), CORE_REF, value))
  })

  it.each([
    ['image id', (value: any) => { value[0].Id = digest('1') }],
    ['repository digest', (value: any) => { value[0].RepoDigests = [`caddy@${digest('9')}`] }],
    ['architecture', (value: any) => { value[0].Architecture = 'arm64' }],
    ['OS', (value: any) => { value[0].Os = 'windows' }],
    ['entrypoint', (value: any) => { value[0].Config.Entrypoint = ['caddy'] }],
    ['command', (value: any) => { value[0].Config.Cmd = ['caddy', 'reverse-proxy'] }],
    ['working directory', (value: any) => { value[0].Config.WorkingDir = '/tmp' }],
    ['image user', (value: any) => { value[0].Config.User = '10001:10001' }],
    ['Caddy version', (value: any) => { value[0].Config.Env[1] = 'CADDY_VERSION=v2.11.3' }],
  ] as const)('rejects ingress %s drift', (_name, mutate) => {
    const value: any = ingressImage(); mutate(value)
    expectUnavailable('ingressImage', () => create(release(), CORE_REF, coreImage(), value))
  })

  it('requires the exact unique core environment and rejects loader or secret-bearing names', () => {
    for (const entry of [
      'NODE_ENV=development',
      'NODE_VERSION=latest',
      'PATH=',
      `NODE_OPTIONS=${CANARY}`,
      `OPENAI_API_KEY=${CANARY}`,
      `DATABASE_URL=${CANARY}`,
    ]) {
      const image: any = coreImage()
      const key = entry.slice(0, entry.indexOf('='))
      const index = image[0].Config.Env.findIndex((value: string) => value.startsWith(`${key}=`))
      if (index < 0) image[0].Config.Env.push(entry); else image[0].Config.Env[index] = entry
      expectUnavailable('coreImage', () => create(release(), CORE_REF, image))
    }
    const duplicate: any = coreImage(); duplicate[0].Config.Env.push('NODE_ENV=production')
    expectUnavailable('coreImage', () => create(release(), CORE_REF, duplicate))
  })

  it('rejects zero or multiple inspect results and malformed inspect shapes', () => {
    for (const value of [null, {}, [], [coreImage()[0], coreImage()[0]]]) {
      expectUnavailable('coreImage', () => create(release(), CORE_REF, value))
    }
    for (const value of [null, {}, [], [ingressImage()[0], ingressImage()[0]]]) {
      expectUnavailable('ingressImage', () => create(release(), CORE_REF, coreImage(), value))
    }
  })

  it('rejects accessors, hidden or symbol keys, custom prototypes, holes, and custom array properties without invoking getters', () => {
    let reads = 0
    const accessor: any = coreImage()
    Object.defineProperty(accessor[0].Config, 'Cmd', { enumerable: true, get: () => { reads += 1; return ['node'] } })
    expectUnavailable('coreImage', () => create(release(), CORE_REF, accessor)); expect(reads).toBe(0)

    const hidden: any = coreImage(); Object.defineProperty(hidden[0], CANARY, { enumerable: false, value: CANARY })
    expectUnavailable('coreImage', () => create(release(), CORE_REF, hidden))
    const symbol: any = ingressImage(); symbol[0].Config[Symbol(CANARY)] = CANARY
    expectUnavailable('ingressImage', () => create(release(), CORE_REF, coreImage(), symbol))
    const prototype: any = coreImage(); Object.setPrototypeOf(prototype[0].Config.Labels, { [CANARY]: CANARY })
    expectUnavailable('coreImage', () => create(release(), CORE_REF, prototype))
    const hole: any = coreImage(); hole[0].Config.Env = new Array(7)
    expectUnavailable('coreImage', () => create(release(), CORE_REF, hole))
    const custom: any = ingressImage(); Object.defineProperty(custom[0].RepoDigests, 'toJSON', { enumerable: true, value: () => [D1_CADDY_IMAGE] })
    expectUnavailable('ingressImage', () => create(release(), CORE_REF, coreImage(), custom))

    const recordAccessor: any = release()
    Object.defineProperty(recordAccessor, 'hostAppImageDigest', { enumerable: true, get: () => { reads += 1; return CORE_DIGEST } })
    expectUnavailable('approvedHostRelease', () => create(recordAccessor)); expect(reads).toBe(0)
  })

  it('hashes a byte snapshot, rejects Caddyfile drift, and retains neither bytes nor inspect objects', () => {
    const bytes = CADDY_BYTES.slice(); const core: any = coreImage()
    const result = create(release(), CORE_REF, core, ingressImage(), bytes)
    bytes.fill(0); core[0].Config.Env[0] = `PATH=${CANARY}`; core[0].Id = digest('1')
    expect(result.caddyfileDigest).toBe(D1_CADDYFILE_DIGEST)
    expect(result.coreImageId).toBe(CORE_ID)
    expect(result.imageDefaults.path).not.toContain(CANARY)
    const drifted = CADDY_BYTES.slice(); drifted[0] ^= 1
    expectUnavailable('caddyfile', () => create(release(), CORE_REF, coreImage(), ingressImage(), drifted))
    expectUnavailable('caddyfile', () => create(release(), CORE_REF, coreImage(), ingressImage(), Buffer.from(CADDY_BYTES)))
  })

  it('redacts raw attacker values from stable failures', () => {
    const image: any = coreImage(); image[0].Config.Env.push(`OPENAI_API_KEY=${CANARY}`)
    const failure = expectUnavailable('coreImage', () => create(release(), CORE_REF, image))
    expect(failure.message).toBe(D1HostErrorCode.COLLECTION_NOT_READY)
    expect(failure.stack).not.toContain(CANARY)

    const injected = () => new D1HostError(D1HostErrorCode.PLAN_INVALID, { field: CANARY })
    const hostileCore = new Proxy(coreImage()[0]!, {
      getOwnPropertyDescriptor: () => { throw injected() },
    })
    const hostileIngress = new Proxy(ingressImage()[0]!, {
      ownKeys: () => { throw injected() },
    })
    const hostileCaddyfile = new Proxy(CADDY_BYTES.slice(), {
      getPrototypeOf: () => { throw injected() },
    })
    for (const [field, action] of [
      ['coreImage', () => create(release(), CORE_REF, [hostileCore])],
      ['ingressImage', () => create(release(), CORE_REF, coreImage(), [hostileIngress])],
      ['caddyfile', () => create(release(), CORE_REF, coreImage(), ingressImage(), hostileCaddyfile)],
    ] as const) {
      const remapped = expectUnavailable(field, action)
      expect((remapped as D1HostError).details).toEqual({ field })
      expect(remapped.stack).not.toContain(CANARY)
    }
    expectUnavailable('caddyfile', () => create(release(), CORE_REF, coreImage(), ingressImage(), new Uint8Array(64 * 1024 + 1)))
  })
})
