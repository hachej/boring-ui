import { readFile } from 'node:fs/promises'

import { parse } from 'yaml'
import { describe, expect, it, vi } from 'vitest'

import {
  AGENT_HOST_CADDY_IMAGE,
  renderAgentHostComposeCommands,
  runAgentHostComposeAction,
  type AgentHostComposeEffect,
  type AgentHostComposeProcess,
  type AgentHostComposeResult,
} from '../composeAdapter.js'
import { AgentHostErrorCode, parseAgentHostPlan } from '../agentHostPlan.js'

const digest = `sha256:${'a'.repeat(64)}`
const composeUrl = new URL('../../../../../../deploy/agent-host/compose.yml', import.meta.url)
const collectionUrl = new URL('../../../../../../deploy/agent-host/collection.example.json', import.meta.url)

const images = {
  schemaVersion: 1,
  ingressImage: AGENT_HOST_CADDY_IMAGE,
  coreAppImage: `ghcr.io/hachej/boring-ui@${digest}`,
} as const

async function examplePlan(): Promise<unknown> {
  return JSON.parse(await readFile(collectionUrl, 'utf8')) as unknown
}

const base = [
  'compose', '--file', '/opt/boring/agent-host/compose.yml',
  '--project-directory', '/opt/boring/agent-host', '--project-name', 'boring-agent-host',
]
const expectedEnv = {
  COMPOSE_DISABLE_ENV_FILE: '1',
  AGENT_HOST_CORE_APP_IMAGE: images.coreAppImage,
  AGENT_HOST_ID: 'eu-host-1',
  AGENT_HOST_INGRESS_IMAGE: images.ingressImage,
  AGENT_HOST_MATERIALIZED_HOST_ROOT: '/run/boring/agent-host/eu-host-1',
  AGENT_HOST_STATE_ROOT: '/var/lib/boring/agent-host/eu-host-1',
  AGENT_HOST_CONTROL_ROOT: '/run/boring/agent-host/control',
}

function runnerWithFreshNetwork(composeResult: AgentHostComposeResult = { exitCode: 0 }) {
  return vi.fn(async (process: AgentHostComposeProcess): Promise<AgentHostComposeResult> => {
    if (process.command === 'docker' && process.args[0] === 'network') return { exitCode: 0, stdout: '' }
    if (process.command === 'ip') return { exitCode: 0, stdout: '[]' }
    return composeResult
  })
}

describe('AgentHost Compose topology', () => {
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
    expect(Object.keys(document.volumes)).toEqual(['agent-host-workspaces', 'agent-host-sessions'])
    expect(ingress.image).toBe('${AGENT_HOST_INGRESS_IMAGE:?AGENT_HOST_INGRESS_IMAGE is required}')
    expect(ingress.command).toEqual(['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
    expect(ingress.volumes).toEqual([{
      type: 'bind', source: './Caddyfile', target: '/etc/caddy/Caddyfile', read_only: true, bind: { create_host_path: false },
    }])
    expect(JSON.stringify(ingress.command)).not.toMatch(/\$\{|forwarded|header|\/bin\/sh/i)
    expect(ingress).not.toHaveProperty('environment')
    expect(core.image).toBe('${AGENT_HOST_CORE_APP_IMAGE:?AGENT_HOST_CORE_APP_IMAGE is required}')
    expect(ingress.ports).toEqual(['80:8080'])
    expect(core).not.toHaveProperty('ports')
    expect(ingress.restart).toBe('unless-stopped')
    expect(core.restart).toBe('unless-stopped')
    expect(core.env_file).toEqual(['/etc/boring/agent-host/core.env'])
    expect(core.environment).not.toHaveProperty('BORING_AGENT_HOST_OWNER_UID')
    expect(core.healthcheck).toEqual({
      test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"],
      interval: '30s', timeout: '5s', start_period: '10s', retries: 3,
    })
    expect(core.environment).toMatchObject({
      BORING_AGENT_HOST_ID: '${AGENT_HOST_ID:?AGENT_HOST_ID is required}',
      TRUST_PROXY_CIDRS: '192.168.255.250/32',
      TRUST_PROXY_HOPS: '1',
    })
    expect(ingress.networks).toEqual({ 'agent-host-edge': { ipv4_address: '192.168.255.250' } })
    expect(core.networks).toEqual(['agent-host-edge'])
    expect(document.networks).toEqual({ 'agent-host-edge': { driver: 'bridge', ipam: { config: [{ subnet: '192.168.255.248/29', gateway: '192.168.255.249' }] } } })
    expect(mounts).toEqual([
      { type: 'volume', source: 'agent-host-workspaces', target: '/data/workspaces' },
      { type: 'volume', source: 'agent-host-sessions', target: '/data/pi-sessions' },
      {
        type: 'bind', source: '${AGENT_HOST_STATE_ROOT:?AGENT_HOST_STATE_ROOT is required}',
        target: '/var/lib/boring/agent-host/${AGENT_HOST_ID:?AGENT_HOST_ID is required}', read_only: true,
        bind: { create_host_path: false },
      },
      {
        type: 'bind', source: '${AGENT_HOST_MATERIALIZED_HOST_ROOT:?AGENT_HOST_MATERIALIZED_HOST_ROOT is required}',
        target: '/run/boring/agent-host', read_only: true, bind: { create_host_path: false },
      },
      {
        type: 'bind', source: '${AGENT_HOST_CONTROL_ROOT:?AGENT_HOST_CONTROL_ROOT is required}',
        target: '/run/boring/agent-host/control', bind: { create_host_path: false },
      },
    ])

    const serialized = JSON.stringify(document)
    expect(serialized).not.toMatch(/database:|postgres|checkout|bindingId|secretRefs|revision|active|current|--force-recreate|\bdown\b/)
  })

  it('ships a valid three-binding host plan without secret values', async () => {
    const raw = await examplePlan()
    const parsed = parseAgentHostPlan(raw)

    expect(parsed.bindings.map((binding) => binding.bindingId)).toEqual(['claims', 'insurance', 'travel'])
    expect(JSON.stringify(raw)).not.toMatch(/password|token|api[_-]?key/i)
  })
})

describe('AgentHost Compose command policy', () => {
  it.each<[AgentHostComposeEffect, readonly string[][]]>([
    ['initial', [
      [...base, 'run', '--rm', '--no-deps', 'core-app', 'node', 'apps/full-app/dist/server/migrate.js'],
      [...base, 'up', '-d', '--no-deps', 'core-app'],
    ]],
    ['start-ingress', [[...base, 'up', '-d', '--no-deps', 'ingress']]],
    ['restart-core', [[...base, 'up', '-d', '--no-deps', 'core-app']]],
    ['no-compose', []],
  ])('renders the exact %s argv matrix', async (effect, expected) => {
    const commands = renderAgentHostComposeCommands(effect, await examplePlan(), images)

    expect(commands.map((command) => command.args)).toEqual(expected)
    for (const command of commands) {
      expect(command).toEqual({ command: 'docker', args: command.args, cwd: '/opt/boring/agent-host', env: expectedEnv, shell: false })
      expect(JSON.stringify(command)).not.toMatch(/--force-recreate|\bdown\b|restart|database|postgres|revision|desiredStateDigest|secretRefs|manifest|canary|model-credential|workspace:insurance/)
    }
  })

  it('makes zero Compose calls for online publication effects', async () => {
    const runner = vi.fn(async (_process: AgentHostComposeProcess) => ({ exitCode: 0 }))
    await runAgentHostComposeAction('no-compose', await examplePlan(), images, runner)
    expect(runner).not.toHaveBeenCalled()
  })

  it.each([
    ['core digest mismatch', { ...images, coreAppImage: `ghcr.io/hachej/boring-ui@sha256:${'c'.repeat(64)}` }],
    ['tagged core image', { ...images, coreAppImage: 'ghcr.io/hachej/boring-ui:latest' }],
    ['tagged ingress image', { ...images, ingressImage: 'caddy:2' }],
    ['other pinned ingress image', { ...images, ingressImage: `caddy@sha256:${'b'.repeat(64)}` }],
    ['other ingress repository', { ...images, ingressImage: AGENT_HOST_CADDY_IMAGE.replace('caddy@', 'registry.example/caddy@') }],
    ['caller-supplied project drift', { ...images, projectName: 'old-project' }],
    ['caller-supplied compose drift', { ...images, composeFile: '/old/compose.yml' }],
    ['caller-supplied state drift', { ...images, stateRoot: '/old/state' }],
    ['caller-supplied materialized-root drift', { ...images, materializedHostRoot: '/run/boring/agent-host/other-host' }],
  ])('rejects %s before invoking the runner', async (_name, invalidImages) => {
    const runner = vi.fn(async (_process: AgentHostComposeProcess) => ({ exitCode: 0 }))

    await expect(runAgentHostComposeAction('initial', await examplePlan(), invalidImages, runner)).rejects.toMatchObject({
      code: AgentHostErrorCode.PLAN_INVALID,
    })
    expect(runner).not.toHaveBeenCalled()
  })

  it('stops initial boot when migration fails', async () => {
    const runner = runnerWithFreshNetwork({ exitCode: 17 })

    await expect(runAgentHostComposeAction('initial', await examplePlan(), images, runner)).rejects.toMatchObject({
      code: AgentHostErrorCode.COLLECTION_NOT_READY,
      details: { field: 'compose' },
    })
    expect(runner).toHaveBeenCalledTimes(3)
    expect(runner.mock.calls[2]?.[0].args.at(-1)).toBe('apps/full-app/dist/server/migrate.js')
  })

  it.each([
    ['spawn', runnerWithFreshNetwork({ exitCode: 0 }), true],
    ['nonzero', runnerWithFreshNetwork({ exitCode: 17 }), false],
  ])('maps %s failure to one redacted collection error', async (_name, runner, spawn) => {
    if (spawn) runner.mockImplementationOnce(async () => ({ exitCode: 0, stdout: '' }))
      .mockImplementationOnce(async () => ({ exitCode: 0, stdout: '[]' }))
      .mockImplementationOnce(async () => { throw new Error('spawn /private/canary TOKEN=secret') })
    let failure: unknown
    try {
      await runAgentHostComposeAction('initial', await examplePlan(), images, runner)
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({
      code: AgentHostErrorCode.COLLECTION_NOT_READY,
      details: { field: 'compose' },
    })
    expect(JSON.stringify(failure)).not.toMatch(/private|canary|TOKEN|secret|compose\.yml|stdout|stderr|argv/)
  })
})
