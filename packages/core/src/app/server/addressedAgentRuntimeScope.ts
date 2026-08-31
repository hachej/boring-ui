import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import path from 'node:path'

import {
  compactPiPackages,
  type PiHarnessOptions,
  type ResolvedAgentRuntimeScope,
  type RuntimeModeAdapter,
  type RuntimeModeId,
} from '@hachej/boring-agent/server'
import { ErrorCode, type AgentTool } from '@hachej/boring-agent/shared'

/** Declarative Pi resources a trusted host may grant to one authorized Agent seat. */
export type AgentPiCapabilityOptions = Pick<
  PiHarnessOptions,
  'additionalSkillPaths' | 'packages' | 'extensionPaths'
>

/** Shared authorization context for addressed Agent capability policies. */
export interface AddressedAgentCapabilityContext {
  agentTypeId: string
  workspaceId: string
  workspaceRoot: string
  runtimeMode: RuntimeModeId
  workspaceFsCapability?: RuntimeModeAdapter['workspaceFsCapability']
  authSubject: string
}

const HOST_EXTENSION_RUNTIME_MODES = new Set<RuntimeModeId>(['direct', 'local'])
const TRUSTED_PI_MONO_LOOP_ENTRY = path.join('node_modules', 'pi-mono-loop', 'index.ts')

/** Resolve the sole host-installed extension entry admitted in isolated modes. */
export function resolveTrustedPiMonoLoopExtensionPath(appRoot: string): string {
  return realpathSync(path.resolve(appRoot, TRUSTED_PI_MONO_LOOP_ENTRY))
}

function isTrustedIsolatedAddressedExtension(
  extensionPath: string,
  trustedExtensionPaths: readonly string[],
): boolean {
  if (!path.isAbsolute(extensionPath)) return false
  const normalized = path.resolve(extensionPath)
  return trustedExtensionPaths.some((trustedPath) => normalized === path.resolve(trustedPath))
}

function isolatesHostExtensions(runtimeMode: RuntimeModeId): boolean {
  // Custom modes fail closed until their adapter contract grows an explicit
  // host-extension capability. This prevents a new remote provider ID from
  // silently bypassing the isolation boundary.
  return !HOST_EXTENSION_RUNTIME_MODES.has(runtimeMode)
}

function dedupeStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

function assertNoExplicitExtensions(
  extensionPaths: readonly string[] | undefined,
  extensionFactories: readonly unknown[] | undefined,
  runtimeMode: RuntimeModeId,
  source: string,
  trustedExtensionPaths: readonly string[] = [],
): void {
  if (!isolatesHostExtensions(runtimeMode)) return
  const forbiddenPaths = (extensionPaths ?? []).filter(
    (extensionPath) => !isTrustedIsolatedAddressedExtension(extensionPath, trustedExtensionPaths),
  )
  if (forbiddenPaths.length > 0 || (extensionFactories?.length ?? 0) > 0) {
    throw Object.assign(
      new Error(`${source} cannot grant host Pi extensions in ${runtimeMode} mode`),
      { code: ErrorCode.enum.CONFIG_INVALID, statusCode: 500 },
    )
  }
}

/**
 * Remote runtimes never load caller- or package-discovered host extensions.
 * Enforce that boundary for both static and hot-reloadable Pi options instead
 * of relying on Pi's `noExtensions` flag, which still permits explicit paths.
 */
export function applyRuntimePiExtensionIsolation(
  pi: PiHarnessOptions,
  runtimeMode: RuntimeModeId,
  source = 'Pi options',
): PiHarnessOptions {
  if (!isolatesHostExtensions(runtimeMode)) return pi
  assertNoExplicitExtensions(pi.extensionPaths, pi.extensionFactories, runtimeMode, source)
  const getHotReloadableResources = pi.getHotReloadableResources
  return {
    ...pi,
    noExtensions: true,
    ...(getHotReloadableResources
      ? {
          getHotReloadableResources: () => {
            const resources = getHotReloadableResources()
            assertNoExplicitExtensions(resources.extensionPaths, undefined, runtimeMode, `${source} hot resources`)
            return resources
          },
        }
      : {}),
  }
}

export function mergePiOptions(
  base?: PiHarnessOptions,
  override?: PiHarnessOptions,
): PiHarnessOptions | undefined {
  if (!base && !override) return undefined
  return {
    ...base,
    ...override,
    additionalSkillPaths: dedupeStrings([
      ...(base?.additionalSkillPaths ?? []),
      ...(override?.additionalSkillPaths ?? []),
    ]),
    packages: compactPiPackages([
      ...(base?.packages ?? []),
      ...(override?.packages ?? []),
    ]),
    extensionPaths: dedupeStrings([
      ...(base?.extensionPaths ?? []),
      ...(override?.extensionPaths ?? []),
    ]),
    extensionFactories: [
      ...(base?.extensionFactories ?? []),
      ...(override?.extensionFactories ?? []),
    ],
  }
}

export function normalizeAgentPiCapabilityOptions(
  pi: AgentPiCapabilityOptions | undefined,
  runtimeMode: RuntimeModeId,
  trustedExtensionPaths: readonly string[] = [],
): AgentPiCapabilityOptions | undefined {
  if (!pi) return undefined
  // The initial Factory slice admits only the exact host-resolved loop entry
  // supplied by Core. Static, ambient, hot-reloaded, authored, and every other
  // addressed extension remain blocked by the isolated-runtime policy.
  assertNoExplicitExtensions(pi.extensionPaths, undefined, runtimeMode, 'getAgentPi', trustedExtensionPaths)
  const normalized = {
    additionalSkillPaths: dedupeStrings(pi.additionalSkillPaths ?? []),
    packages: compactPiPackages(pi.packages ?? []),
    extensionPaths: dedupeStrings(pi.extensionPaths ?? []),
  }
  return normalized.additionalSkillPaths.length > 0
    || normalized.packages.length > 0
    || normalized.extensionPaths.length > 0
    ? normalized
    : undefined
}

function canonicalToolContractValue(value: unknown, field: string): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((entry, index) => canonicalToolContractValue(entry, `${field}[${index}]`)).join(',')}]`
  }
  if (!value || typeof value !== 'object' || value instanceof URL) {
    throw new Error(`${field} contains an opaque value without a stable tool contract`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${field} contains an opaque value without a stable tool contract`)
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, entry]) => (
    `${JSON.stringify(key)}:${canonicalToolContractValue(entry, `${field}.${key}`)}`
  )).join(',')}}`
}

function addressedToolContractDigests(tools: readonly AgentTool[]): string[] {
  return tools.map((tool) => {
    const { execute: _execute, ...contract } = tool
    return createHash('sha256')
      .update(canonicalToolContractValue(contract, `agentTool.${tool.name}`))
      .digest('hex')
  }).sort()
}

export interface AddressedAgentRuntimeComposition {
  identity: string
  physicalBindingIdentity: string
  resourceInputDigest: string
  extraTools: readonly AgentTool[]
  pi?: PiHarnessOptions
}

/**
 * Compose the semantic identity, stable physical slot, and immutable resource
 * digest for one addressed Agent. This function is deliberately pure so every
 * caller follows the same slot/identity rules, including empty grants.
 */
export function composeAddressedAgentRuntimeScope(input: {
  runtime: Omit<ResolvedAgentRuntimeScope, 'environment'>
  agentTypeId: string
  agentTools: readonly AgentTool[]
  addressedPi?: AgentPiCapabilityOptions
  addressedPiResourceInputDigest?: string
}): AddressedAgentRuntimeComposition {
  const {
    runtime,
    agentTypeId,
    agentTools,
    addressedPi,
    addressedPiResourceInputDigest,
  } = input
  const toolContractDigests = addressedToolContractDigests(agentTools)
  const identity = createHash('sha256').update(JSON.stringify({
    baseIdentity: runtime.identity,
    agentTypeId,
    toolContractDigests,
    addressedPi: canonicalToolContractValue(addressedPi ?? null, 'agentPi'),
  })).digest('hex')
  const physicalBindingIdentity = createHash('sha256').update(JSON.stringify({
    basePhysicalBindingIdentity: runtime.physicalBindingIdentity ?? runtime.identity,
    agentTypeId,
  })).digest('hex')
  const resourceInputDigest = `sha256:${createHash('sha256').update(JSON.stringify({
    baseResourceInputDigest: runtime.resourceInputDigest ?? null,
    agentTypeId,
    toolContractDigests,
    addressedPiResourceInputDigest,
  })).digest('hex')}`
  return {
    identity,
    physicalBindingIdentity,
    resourceInputDigest,
    extraTools: [...(runtime.extraTools ?? []), ...agentTools],
    pi: addressedPi ? mergePiOptions(runtime.pi, addressedPi) : runtime.pi,
  }
}
