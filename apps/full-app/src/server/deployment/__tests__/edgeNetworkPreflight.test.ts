import { describe, expect, it, vi } from 'vitest'

import { AGENT_HOST_CADDY_IMAGE, runAgentHostComposeAction, type AgentHostComposeProcess, type AgentHostComposeResult } from '../composeAdapter.js'
import { preflightAgentHostEdgeNetwork } from '../edgeNetworkPreflight.js'
import { AgentHostErrorCode } from '../agentHostPlan.js'

const id = 'a'.repeat(64)
const bridge = `br-${id.slice(0, 12)}`
const edgeNetwork = {
  Id: id, Name: 'boring-agent-host_agent-host-edge', Driver: 'bridge', Scope: 'local',
  Ingress: false, ConfigOnly: false,
  IPAM: { Config: [{ Subnet: '192.168.255.248/29', Gateway: '192.168.255.249' }] },
  Options: {},
  Labels: {
    'com.docker.compose.project': 'boring-agent-host', 'com.docker.compose.network': 'agent-host-edge',
  },
}
const ownedRoutes = [
  { dst: '192.168.255.248/29', dev: bridge, protocol: 'kernel', scope: 'link', prefsrc: '192.168.255.249', flags: [] },
  { type: 'local', dst: '192.168.255.249', dev: bridge, table: 'local', protocol: 'kernel', scope: 'host', prefsrc: '192.168.255.249', flags: [] },
  { type: 'broadcast', dst: '192.168.255.255', dev: bridge, table: 'local', protocol: 'kernel', scope: 'link', prefsrc: '192.168.255.249', flags: [] },
]

const result = (stdout: unknown, exitCode = 0): AgentHostComposeResult => ({
  exitCode, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
})

function preflightRunner(networks: unknown[] = [], routes: unknown[] = []) {
  return vi.fn(async (process: AgentHostComposeProcess): Promise<AgentHostComposeResult> => {
    if (process.command === 'docker' && process.args[1] === 'ls') {
      return result(networks.map((network) => JSON.stringify((network as { Id: string }).Id)).join('\n'))
    }
    if (process.command === 'docker' && process.args[1] === 'inspect') return result(networks)
    if (process.command === 'ip') return result(routes)
    return { exitCode: 0 }
  })
}

async function expectEdgeFailure(action: Promise<unknown>): Promise<void> {
  let failure: unknown
  try {
    await action
  } catch (error) {
    failure = error
  }
  expect(failure).toMatchObject({
    code: AgentHostErrorCode.COLLECTION_NOT_READY,
    details: { field: 'edgeNetwork' },
  })
  expect(JSON.stringify(failure)).not.toMatch(/docker|route|network id|stdout|private|secret|192\.168/)
}

describe('AgentHost edge-network preflight', () => {
  it('accepts a fresh host and ignores its default route', async () => {
    const runner = preflightRunner([], [{ dst: 'default', gateway: '10.0.0.1', dev: 'eth0' }])
    await preflightAgentHostEdgeNetwork(runner)
    expect(runner.mock.calls.map(([process]) => [process.command, ...process.args])).toEqual([
      ['docker', 'network', 'ls', '--no-trunc', '--format', '{{json .ID}}'],
      ['ip', '-json', '-4', 'route', 'show', 'table', 'all'],
    ])
    expect(runner.mock.calls.every(([process]) => process.shell === false && process.maxStdoutBytes !== undefined)).toBe(true)
  })

  it('accepts exact owned network and exact kernel-owned routes', async () => {
    const runner = preflightRunner([edgeNetwork], ownedRoutes)

    await preflightAgentHostEdgeNetwork(runner)

    expect(runner.mock.calls[1]?.[0].args).toEqual(['network', 'inspect', id])
  })

  it.each([
    ['foreign exact Docker overlap', [{ ...edgeNetwork, Name: 'foreign' }], []],
    ['foreign broader Docker overlap', [{ ...edgeNetwork, Name: 'foreign', IPAM: { Config: [{ Subnet: '192.168.0.0/16' }] } }], []],
    ['foreign narrower Docker overlap', [{ ...edgeNetwork, Name: 'foreign', IPAM: { Config: [{ Subnet: '192.168.255.250/32' }] } }], []],
    ['owned subnet drift', [{ ...edgeNetwork, IPAM: { Config: [{ Subnet: '192.168.255.248/29', Gateway: '192.168.255.250' }] } }], ownedRoutes],
    ['owned label drift', [{ ...edgeNetwork, Labels: { ...edgeNetwork.Labels, 'com.docker.compose.project': 'foreign' } }], ownedRoutes],
    ['owned bridge drift', [{ ...edgeNetwork, Options: { 'com.docker.network.bridge.name': 'br-wrong' } }], ownedRoutes],
    ['host route overlap', [], [{ dst: '192.168.255.248/29', dev: 'eth0' }]],
    ['owned missing route', [edgeNetwork], ownedRoutes.slice(0, 2)],
    ['owned extra overlap', [edgeNetwork], [...ownedRoutes, { dst: '192.168.255.251', dev: bridge }]],
  ])('rejects %s', async (_name, networks, routes) => {
    await expectEdgeFailure(preflightAgentHostEdgeNetwork(preflightRunner(networks, routes)))
  })

  it('accepts built-in networks with null IPAM and unrelated IPv6 subnets', async () => {
    const host = {
      ...edgeNetwork, Id: 'b'.repeat(64), Name: 'host', Driver: 'host',
      IPAM: { Config: null }, Labels: null, Options: null,
    }
    const ipv6 = {
      ...edgeNetwork, Id: 'c'.repeat(64), Name: 'ipv6-only',
      IPAM: { Config: [{ Subnet: 'fd00::/64' }] }, Labels: null,
    }

    await preflightAgentHostEdgeNetwork(preflightRunner([host, ipv6], []))
  })

  it.each([
    ['list nonzero', vi.fn(async () => result('', 17))],
    ['list spawn', vi.fn(async () => { throw new Error('private network secret') })],
    ['malformed list', vi.fn(async () => result('not-json'))],
    ['duplicate list', vi.fn(async () => result(`${JSON.stringify(id)}\n${JSON.stringify(id)}`))],
    ['oversized list', vi.fn(async () => result('x'.repeat(64 * 1024 + 1)))],
    ['missing inspect record', vi.fn(async (process: AgentHostComposeProcess) => process.args[1] === 'ls' ? result(JSON.stringify(id)) : result([]))],
    ['inspect nonzero', vi.fn(async (process: AgentHostComposeProcess) => process.args[1] === 'ls' ? result(JSON.stringify(id)) : result('', 17))],
    ['malformed inspect', vi.fn(async (process: AgentHostComposeProcess) => process.args[1] === 'ls' ? result(JSON.stringify(id)) : result('not-json'))],
    ['oversized inspect', vi.fn(async (process: AgentHostComposeProcess) => process.args[1] === 'ls' ? result(JSON.stringify(id)) : result('x'.repeat(512 * 1024 + 1)))],
    ['routes nonzero', vi.fn(async (process: AgentHostComposeProcess) => process.command === 'docker' ? result('') : result('', 17))],
    ['malformed routes', vi.fn(async (process: AgentHostComposeProcess) => process.command === 'docker' ? result('') : result('not-json'))],
    ['oversized routes', vi.fn(async (process: AgentHostComposeProcess) => process.command === 'docker' ? result('') : result('x'.repeat(512 * 1024 + 1)))],
  ])('redacts %s failures', async (_name, runner) => {
    await expectEdgeFailure(preflightAgentHostEdgeNetwork(runner))
  })
})

describe('AgentHost edge-network command ordering', () => {
  const digest = `sha256:${'a'.repeat(64)}`
  const plan = {
    schemaVersion: 1, hostId: 'eu-host-1', expectedHostRevision: null,
    hostAppImageDigest: digest, runtimeProfileRef: 'runtime@1', databaseRef: 'database@1',
    workspaceRootPolicyRef: 'workspaces@1', sessionRootPolicyRef: 'sessions@1',
    bindings: [{
      bindingId: 'insurance', hostname: 'insurance.example.com', workspaceId: 'workspace:insurance',
      defaultDeploymentId: 'deployment:insurance', bundleRef: 'bundle@1', deploymentRef: 'deployment@1',
      workspaceAllocationRef: 'workspace-allocation@1', sessionAllocationRef: 'session-allocation@1',
      ownerPrincipalRef: 'principal@1', landing: { title: 'Insurance', summary: 'Compare policies' },
      environmentRef: 'environment@1', secretRefs: [],
    }],
  }
  const images = { schemaVersion: 1, ingressImage: AGENT_HOST_CADDY_IMAGE, coreAppImage: `ghcr.io/hachej/boring-ui@${digest}` }

  it.each(['initial', 'restart-core'] as const)('runs preflight before the %s Compose effect', async (effect) => {
    const runner = preflightRunner()
    await runAgentHostComposeAction(effect, plan, images, runner)

    const calls = runner.mock.calls.map(([process]) => [process.command, ...process.args])
    expect(calls[0]?.slice(0, 3)).toEqual(['docker', 'network', 'ls'])
    expect(calls[1]?.slice(0, 3)).toEqual(['ip', '-json', '-4'])
    expect(calls[2]?.slice(0, 3)).toEqual(['docker', 'compose', '--file'])
  })

  it('does no preflight or Compose work for no-compose', async () => {
    const runner = preflightRunner()
    await runAgentHostComposeAction('no-compose', plan, images, runner)
    expect(runner).not.toHaveBeenCalled()
  })
})
