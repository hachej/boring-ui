import { isIP } from 'node:net'

import { D1HostError, D1HostErrorCode } from './d1Plan.js'

const COMPOSE_DIRECTORY = '/opt/boring/d1'
const EDGE_SUBNET = '192.168.255.248/29'
const EDGE_GATEWAY = '192.168.255.249'
const EDGE_BROADCAST = '192.168.255.255'
const EDGE_NETWORK_NAME = 'boring-d1_d1-edge'
const PROJECT_LABEL = 'boring-d1'
const NETWORK_LABEL = 'd1-edge'
const MAX_NETWORK_IDS = 128
const MAX_LIST_BYTES = 64 * 1024
const MAX_INSPECT_BYTES = 512 * 1024
const MAX_ROUTES_BYTES = 512 * 1024
const DOCKER_ID_RE = /^[a-f0-9]{64}$/

export interface D1HostProcess {
  readonly command: 'docker' | 'ip'
  readonly args: readonly string[]
  readonly cwd: typeof COMPOSE_DIRECTORY
  readonly env: Readonly<Record<string, string>>
  readonly shell: false
  readonly maxStdoutBytes?: number
}

export interface D1HostResult {
  readonly exitCode: number | null
  readonly stdout?: string
}

export type D1HostRunner = (process: D1HostProcess) => Promise<D1HostResult>

interface DockerNetwork {
  readonly id: string
  readonly name: string
  readonly driver: string
  readonly scope: string
  readonly ingress: boolean
  readonly configOnly: boolean
  readonly subnets: readonly Readonly<{ subnet: string, gateway?: string }>[]
  readonly options: Readonly<Record<string, unknown>>
  readonly labels: Readonly<Record<string, unknown>>
}

interface Ipv4Range { readonly start: bigint, readonly end: bigint }

function edgeNetworkFailure(): D1HostError {
  return new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field: 'edgeNetwork' })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function output(result: D1HostResult, maxBytes: number): string {
  if (result.exitCode !== 0 || typeof result.stdout !== 'string') throw new Error('command failed')
  if (new TextEncoder().encode(result.stdout).byteLength > maxBytes) throw new Error('output too large')
  return result.stdout
}

function hostProcess(command: 'docker' | 'ip', args: readonly string[], maxStdoutBytes: number): D1HostProcess {
  return Object.freeze({
    command,
    args: Object.freeze([...args]),
    cwd: COMPOSE_DIRECTORY,
    env: Object.freeze({}),
    shell: false,
    maxStdoutBytes,
  })
}

function parseNetworkIds(raw: string): readonly string[] {
  const lines = raw.split('\n').filter((line) => line.length > 0)
  if (lines.length > MAX_NETWORK_IDS) throw new Error('too many networks')
  const ids = lines.map((line) => {
    const value: unknown = JSON.parse(line)
    if (typeof value !== 'string' || !DOCKER_ID_RE.test(value)) throw new Error('invalid network id')
    return value
  })
  if (new Set(ids).size !== ids.length) throw new Error('duplicate network id')
  return Object.freeze(ids)
}

function objectMap(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || value === undefined) return Object.freeze({})
  if (!isRecord(value)) throw new Error('invalid object map')
  return value
}

function parseNetwork(value: unknown): DockerNetwork {
  if (!isRecord(value) || !isRecord(value.IPAM) || (value.IPAM.Config !== null && !Array.isArray(value.IPAM.Config))) throw new Error('invalid network')
  if (
    typeof value.Id !== 'string' || !DOCKER_ID_RE.test(value.Id)
    || typeof value.Name !== 'string'
    || typeof value.Driver !== 'string'
    || typeof value.Scope !== 'string'
    || typeof value.Ingress !== 'boolean'
    || typeof value.ConfigOnly !== 'boolean'
  ) throw new Error('invalid network')

  const subnets = (value.IPAM.Config ?? []).map((entry) => {
    if (!isRecord(entry) || typeof entry.Subnet !== 'string') throw new Error('invalid network subnet')
    if (entry.Gateway !== undefined && typeof entry.Gateway !== 'string') throw new Error('invalid network gateway')
    return Object.freeze({ subnet: entry.Subnet, ...(entry.Gateway === undefined ? {} : { gateway: entry.Gateway }) })
  })

  return Object.freeze({
    id: value.Id,
    name: value.Name,
    driver: value.Driver,
    scope: value.Scope,
    ingress: value.Ingress,
    configOnly: value.ConfigOnly,
    subnets: Object.freeze(subnets),
    options: objectMap(value.Options),
    labels: objectMap(value.Labels),
  })
}

function parseNetworks(raw: string, expectedIds: readonly string[]): readonly DockerNetwork[] {
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value) || value.length !== expectedIds.length) throw new Error('network inventory mismatch')
  const networks = value.map(parseNetwork)
  const actualIds = networks.map((network) => network.id)
  if (new Set(actualIds).size !== actualIds.length) throw new Error('duplicate inspected network')
  if (actualIds.some((id) => !expectedIds.includes(id))) throw new Error('unknown inspected network')
  if (expectedIds.some((id) => !actualIds.includes(id))) throw new Error('missing inspected network')
  return Object.freeze(networks)
}

function ipv4Range(value: string): Ipv4Range {
  const [address, prefixRaw, ...extra] = value.split('/')
  if (extra.length > 0 || address === undefined) throw new Error('invalid CIDR')
  const octets = address.split('.')
  if (octets.length !== 4 || octets.some((part) => !/^(?:0|[1-9][0-9]{0,2})$/.test(part))) throw new Error('invalid IPv4')
  const numbers = octets.map(Number)
  if (numbers.some((part) => part > 255)) throw new Error('invalid IPv4')
  const prefix = prefixRaw === undefined ? 32 : Number(prefixRaw)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32 || (prefixRaw !== undefined && String(prefix) !== prefixRaw)) throw new Error('invalid prefix')
  const numeric = numbers.reduce((result, part) => result * 256n + BigInt(part), 0n)
  const size = 1n << BigInt(32 - prefix)
  const start = (numeric / size) * size
  return Object.freeze({ start, end: start + size - 1n })
}

function overlapsEdge(value: string): boolean {
  if (value.includes(':')) {
    const [address, prefixRaw, ...extra] = value.split('/')
    const prefix = Number(prefixRaw)
    if (extra.length > 0 || address === undefined || isIP(address) !== 6 || prefixRaw === undefined
      || !Number.isInteger(prefix) || prefix < 0 || prefix > 128 || String(prefix) !== prefixRaw) throw new Error('invalid IPv6 CIDR')
    return false
  }
  const candidate = ipv4Range(value)
  const edge = ipv4Range(EDGE_SUBNET)
  return candidate.start <= edge.end && edge.start <= candidate.end
}

function assertNetworkInventory(networks: readonly DockerNetwork[]): DockerNetwork | undefined {
  const owned = networks.filter((network) => network.name === EDGE_NETWORK_NAME)
  if (owned.length > 1) throw new Error('duplicate owned network')

  for (const network of networks) {
    for (const entry of network.subnets) {
      if (network !== owned[0] && overlapsEdge(entry.subnet)) throw new Error('foreign network overlap')
    }
  }

  const network = owned[0]
  if (network === undefined) return undefined
  const bridgeName = `br-${network.id.slice(0, 12)}`
  const configuredBridge = network.options['com.docker.network.bridge.name']
  if (
    network.driver !== 'bridge'
    || network.scope !== 'local'
    || network.ingress
    || network.configOnly
    || network.subnets.length !== 1
    || network.subnets[0]?.subnet !== EDGE_SUBNET
    || network.subnets[0]?.gateway !== EDGE_GATEWAY
    || network.labels['com.docker.compose.project'] !== PROJECT_LABEL
    || network.labels['com.docker.compose.network'] !== NETWORK_LABEL
    || (configuredBridge !== undefined && configuredBridge !== bridgeName)
  ) throw new Error('owned network drift')
  return network
}

function exactKeys(value: Record<string, unknown>, expected: Readonly<Record<string, unknown>>): boolean {
  const allowed = new Set([...Object.keys(expected), 'flags'])
  return Object.keys(value).every((key) => allowed.has(key))
    && Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue)
}

function assertRoutes(raw: string, owned: DockerNetwork | undefined): void {
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value)) throw new Error('invalid routes')
  const overlapping: Record<string, unknown>[] = []
  for (const route of value) {
    if (!isRecord(route) || typeof route.dst !== 'string') throw new Error('invalid route')
    if (route.dst === 'default') continue
    if (overlapsEdge(route.dst)) overlapping.push(route)
  }
  if (owned === undefined) {
    if (overlapping.length > 0) throw new Error('host route overlap')
    return
  }

  const bridgeName = `br-${owned.id.slice(0, 12)}`
  const expected = [
    { dst: EDGE_SUBNET, dev: bridgeName, protocol: 'kernel', scope: 'link', prefsrc: EDGE_GATEWAY },
    { type: 'local', dst: EDGE_GATEWAY, dev: bridgeName, table: 'local', protocol: 'kernel', scope: 'host', prefsrc: EDGE_GATEWAY },
    { type: 'broadcast', dst: EDGE_BROADCAST, dev: bridgeName, table: 'local', protocol: 'kernel', scope: 'link', prefsrc: EDGE_GATEWAY },
  ] as const
  if (overlapping.length !== expected.length) throw new Error('owned routes incomplete')
  const unmatched = [...overlapping]
  for (const expectedRoute of expected) {
    const index = unmatched.findIndex((route) => exactKeys(route, expectedRoute))
    if (index < 0) throw new Error('owned route drift')
    unmatched.splice(index, 1)
  }
}

export async function preflightD1EdgeNetwork(runner: D1HostRunner): Promise<void> {
  try {
    const listResult = await runner(hostProcess('docker', ['network', 'ls', '--no-trunc', '--format', '{{json .ID}}'], MAX_LIST_BYTES))
    const ids = parseNetworkIds(output(listResult, MAX_LIST_BYTES))
    let networks: readonly DockerNetwork[] = Object.freeze([])
    if (ids.length > 0) {
      const inspectResult = await runner(hostProcess('docker', ['network', 'inspect', ...ids], MAX_INSPECT_BYTES))
      networks = parseNetworks(output(inspectResult, MAX_INSPECT_BYTES), ids)
    }
    const owned = assertNetworkInventory(networks)
    const routeResult = await runner(hostProcess('ip', ['-json', '-4', 'route', 'show', 'table', 'all'], MAX_ROUTES_BYTES))
    assertRoutes(output(routeResult, MAX_ROUTES_BYTES), owned)
  } catch {
    throw edgeNetworkFailure()
  }
}
