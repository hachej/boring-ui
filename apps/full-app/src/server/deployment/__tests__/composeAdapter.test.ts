import { readFile } from 'node:fs/promises'

import { parse } from 'yaml'
import { describe, expect, it, vi } from 'vitest'

import {
  renderD1ComposeCommands,
  runD1ComposeAction,
  type D1ComposeEffect,
  type D1ComposeProcess,
} from '../composeAdapter.js'
import { D1HostErrorCode, parseD1HostPlan } from '../d1Plan.js'

const digest = `sha256:${'a'.repeat(64)}`
const ingressDigest = `sha256:${'b'.repeat(64)}`
const composeUrl = new URL('../../../../../../deploy/d1/compose.yml', import.meta.url)
const collectionUrl = new URL('../../../../../../deploy/d1/collection.example.json', import.meta.url)

const images = {
  schemaVersion: 1,
  ingressImage: `caddy@${ingressDigest}`,
  coreAppImage: `ghcr.io/hachej/boring-ui@${digest}`,
} as const

async function examplePlan(): Promise<unknown> {
  return JSON.parse(await readFile(collectionUrl, 'utf8')) as unknown
}

const base = [
  'compose', '--file', '/opt/boring/d1/compose.yml',
  '--project-directory', '/opt/boring/d1', '--project-name', 'boring-d1',
]
const expectedEnv = {
  COMPOSE_DISABLE_ENV_FILE: '1',
  D1_CORE_APP_IMAGE: images.coreAppImage,
  D1_HOST_ID: 'eu-host-1',
  D1_INGRESS_IMAGE: images.ingressImage,
  D1_MATERIALIZED_HOST_ROOT: '/run/boring/d1/eu-host-1',
  D1_STATE_ROOT: '/var/lib/boring/d1/eu-host-1',
}

describe('D1 Compose topology', () => {
  it('contains only ingress and one full-collection core service', async () => {
    const document = parse(await readFile(composeUrl, 'utf8')) as {
      services: Record<string, Record<string, unknown>>
      volumes: Record<string, unknown>
      networks: Record<string, Record<string, unknown>>
    }
    const ingress = document.services.ingress
    const core = document.services['core-app']
    const mounts = core.volumes as Array<Record<string, unknown>>

    expect(Object.keys(document.services)).toEqual(['ingress', 'core-app'])
    expect(Object.keys(document.volumes)).toEqual(['d1-workspaces', 'd1-sessions'])
    expect(ingress.image).toBe('${D1_INGRESS_IMAGE:?D1_INGRESS_IMAGE is required}')
    expect(ingress.command).toEqual(['reverse-proxy', '--from', ':8080', '--to', 'core-app:3000'])
    expect(JSON.stringify(ingress.command)).not.toMatch(/\$\{|forwarded|header/i)
    expect(ingress).not.toHaveProperty('environment')
    expect(core.image).toBe('${D1_CORE_APP_IMAGE:?D1_CORE_APP_IMAGE is required}')
    expect(ingress.ports).toEqual(['80:8080'])
    expect(core).not.toHaveProperty('ports')
    expect(ingress.restart).toBe('unless-stopped')
    expect(core.restart).toBe('unless-stopped')
    expect(core.env_file).toEqual(['/etc/boring/d1/core.env'])
    expect(core.environment).toMatchObject({
      BORING_D1_HOST_ID: '${D1_HOST_ID:?D1_HOST_ID is required}',
      TRUST_PROXY_CIDRS: '192.168.255.250/32',
      TRUST_PROXY_HOPS: '1',
    })
    expect(ingress.networks).toEqual({ 'd1-edge': { ipv4_address: '192.168.255.250' } })
    expect(core.networks).toEqual(['d1-edge'])
    expect(document.networks).toEqual({ 'd1-edge': { driver: 'bridge', ipam: { config: [{ subnet: '192.168.255.248/29', gateway: '192.168.255.249' }] } } })
    expect(mounts).toEqual([
      { type: 'volume', source: 'd1-workspaces', target: '/data/workspaces' },
      { type: 'volume', source: 'd1-sessions', target: '/data/pi-sessions' },
      {
        type: 'bind', source: '${D1_STATE_ROOT:?D1_STATE_ROOT is required}',
        target: '/var/lib/boring/d1/${D1_HOST_ID:?D1_HOST_ID is required}', read_only: true,
        bind: { create_host_path: false },
      },
      {
        type: 'bind', source: '${D1_MATERIALIZED_HOST_ROOT:?D1_MATERIALIZED_HOST_ROOT is required}',
        target: '/run/boring/d1', read_only: true, bind: { create_host_path: false },
      },
    ])

    const serialized = JSON.stringify(document)
    expect(serialized).not.toMatch(/database:|postgres|checkout|bindingId|secretRefs|revision|active|current|--force-recreate|\bdown\b/)
  })

  it('ships a valid three-binding host plan without secret values', async () => {
    const raw = await examplePlan()
    const parsed = parseD1HostPlan(raw)

    expect(parsed.bindings.map((binding) => binding.bindingId)).toEqual(['claims', 'insurance', 'travel'])
    expect(JSON.stringify(raw)).not.toMatch(/password|token|api[_-]?key/i)
  })
})

describe('D1 Compose command policy', () => {
  it.each<[D1ComposeEffect, readonly string[][]]>([
    ['initial', [
      [...base, 'run', '--rm', '--no-deps', 'core-app', 'node', 'apps/full-app/dist/server/migrate.js'],
      [...base, 'up', '-d'],
    ]],
    ['restart-core', [[...base, 'up', '-d', '--no-deps', 'core-app']]],
    ['no-compose', []],
  ])('renders the exact %s argv matrix', async (effect, expected) => {
    const commands = renderD1ComposeCommands(effect, await examplePlan(), images)

    expect(commands.map((command) => command.args)).toEqual(expected)
    for (const command of commands) {
      expect(command).toEqual({ command: 'docker', args: command.args, cwd: '/opt/boring/d1', env: expectedEnv, shell: false })
      expect(JSON.stringify(command)).not.toMatch(/--force-recreate|\bdown\b|restart|database|postgres|revision|desiredStateDigest|secretRefs|manifest|canary|model-credential|workspace:insurance/)
    }
  })

  it('makes zero Compose calls for online publication effects', async () => {
    const runner = vi.fn(async (_process: D1ComposeProcess) => ({ exitCode: 0 }))
    await runD1ComposeAction('no-compose', await examplePlan(), images, runner)
    expect(runner).not.toHaveBeenCalled()
  })

  it.each([
    ['core digest mismatch', { ...images, coreAppImage: `ghcr.io/hachej/boring-ui@sha256:${'c'.repeat(64)}` }],
    ['tagged core image', { ...images, coreAppImage: 'ghcr.io/hachej/boring-ui:latest' }],
    ['tagged ingress image', { ...images, ingressImage: 'caddy:2' }],
    ['caller-supplied project drift', { ...images, projectName: 'old-project' }],
    ['caller-supplied compose drift', { ...images, composeFile: '/old/compose.yml' }],
    ['caller-supplied state drift', { ...images, stateRoot: '/old/state' }],
    ['caller-supplied materialized-root drift', { ...images, materializedHostRoot: '/run/boring/d1/other-host' }],
  ])('rejects %s before invoking the runner', async (_name, invalidImages) => {
    const runner = vi.fn(async (_process: D1ComposeProcess) => ({ exitCode: 0 }))

    await expect(runD1ComposeAction('initial', await examplePlan(), invalidImages, runner)).rejects.toMatchObject({
      code: D1HostErrorCode.PLAN_INVALID,
    })
    expect(runner).not.toHaveBeenCalled()
  })

  it('stops initial boot when migration fails', async () => {
    const runner = vi.fn(async (_process: D1ComposeProcess) => ({ exitCode: 17 }))

    await expect(runD1ComposeAction('initial', await examplePlan(), images, runner)).rejects.toMatchObject({
      code: D1HostErrorCode.COLLECTION_NOT_READY,
      details: { field: 'compose' },
    })
    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner.mock.calls[0][0].args.at(-1)).toBe('apps/full-app/dist/server/migrate.js')
  })

  it.each([
    ['spawn', async () => { throw new Error('spawn /private/canary TOKEN=secret') }],
    ['nonzero', async () => ({ exitCode: 17 })],
  ])('maps %s failure to one redacted collection error', async (_name, runner) => {
    let failure: unknown
    try {
      await runD1ComposeAction('initial', await examplePlan(), images, runner)
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({
      code: D1HostErrorCode.COLLECTION_NOT_READY,
      details: { field: 'compose' },
    })
    expect(JSON.stringify(failure)).not.toMatch(/private|canary|TOKEN|secret|compose\.yml|stdout|stderr|argv/)
  })
})
