import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { materializeAgentDirectory } from '@hachej/boring-agent/server'
import type { AgentTool } from '@hachej/boring-agent/shared'

export const ONE_CHAT_SEATS = ['colleague', 'builder', 'documenter'] as const
export type OneChatSeat = (typeof ONE_CHAT_SEATS)[number]

export const ONE_CHAT_TOOL_GROUPS = [
  'intents',
  'instructions',
  'stage',
  'ask_user',
  'run_agents',
  'self_tools',
  'compact',
] as const
export type OneChatToolGroupName = (typeof ONE_CHAT_TOOL_GROUPS)[number]

export interface OneChatAgentPackage {
  readonly seat: OneChatSeat
  readonly packageRoot: string
  readonly packageName: string
  readonly definitionId: string
  readonly version: string
  readonly label: string
  readonly instructionsRef: string
  readonly instructions: string
  readonly definitionDigest?: string
  readonly tools: readonly OneChatToolGroupName[]
}

interface RawAgentManifest {
  readonly name?: unknown
  readonly version?: unknown
  readonly tools?: unknown
  readonly boring?: {
    readonly agent?: {
      readonly definitionId?: unknown
      readonly version?: unknown
      readonly label?: unknown
      readonly instructionsRef?: unknown
    }
  }
}

function nonEmptyString(value: unknown, field: string, manifestPath: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${manifestPath}: ${field} must be a non-empty string`)
  }
  return value.trim()
}

function toolGroups(value: unknown, manifestPath: string): readonly OneChatToolGroupName[] {
  if (!Array.isArray(value)) {
    throw new Error(`${manifestPath}: tools must be an array`)
  }
  const known = new Set<string>(ONE_CHAT_TOOL_GROUPS)
  const seen = new Set<string>()
  return value.map((candidate) => {
    if (typeof candidate !== 'string' || !candidate.trim()) {
      throw new Error(`${manifestPath}: tools entries must be non-empty strings`)
    }
    const name = candidate.trim()
    if (!known.has(name)) {
      throw new Error(
        `${manifestPath}: unknown tool group ${JSON.stringify(name)}; expected one of ${ONE_CHAT_TOOL_GROUPS.join(', ')}`,
      )
    }
    if (seen.has(name)) throw new Error(`${manifestPath}: duplicate tool group ${JSON.stringify(name)}`)
    seen.add(name)
    return name as OneChatToolGroupName
  })
}

export async function loadOneChatAgentPackage(
  agentsRoot: string,
  seat: OneChatSeat,
): Promise<OneChatAgentPackage> {
  const packageRoot = path.join(path.resolve(agentsRoot), seat)
  const manifestPath = path.join(packageRoot, 'package.json')
  let parsed: RawAgentManifest
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as RawAgentManifest
  } catch (error) {
    throw new Error(`${manifestPath}: could not read agent package manifest: ${error instanceof Error ? error.message : String(error)}`)
  }
  const agent = parsed.boring?.agent
  if (!agent || typeof agent !== 'object') throw new Error(`${manifestPath}: missing boring.agent manifest`)
  const packageName = nonEmptyString(parsed.name, 'name', manifestPath)
  const instructionsRef = nonEmptyString(agent.instructionsRef, 'boring.agent.instructionsRef', manifestPath)
  const materialized = await materializeAgentDirectory({
    directory: packageRoot,
    manifest: 'package.json',
    expectedAgentTypeId: seat,
  })
  let staticKnowledge = ''
  if (seat === 'colleague') {
    const capabilitiesPath = path.join(packageRoot, 'knowledge', 'capabilities.md')
    try {
      staticKnowledge = (await readFile(capabilitiesPath, 'utf8')).trim()
    } catch (error) {
      throw new Error(`${capabilitiesPath}: could not read colleague capabilities: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const instructions = [materialized.instructions.trim(), staticKnowledge].filter(Boolean).join('\n\n')
  const definitionDigest = staticKnowledge
    ? createHash('sha256').update(`${materialized.definitionDigest ?? ''}\0${staticKnowledge}`).digest('hex')
    : materialized.definitionDigest

  return {
    seat,
    packageRoot,
    packageName,
    definitionId: materialized.agentTypeId,
    version: materialized.version,
    label: materialized.label ?? seat,
    instructionsRef,
    instructions,
    ...(definitionDigest ? { definitionDigest } : {}),
    tools: toolGroups(parsed.tools, manifestPath),
  }
}

export async function loadOneChatAgentPackages(
  agentsRoot: string,
): Promise<Readonly<Record<OneChatSeat, OneChatAgentPackage>>> {
  const loaded = await Promise.all(ONE_CHAT_SEATS.map((seat) => loadOneChatAgentPackage(agentsRoot, seat)))
  return Object.freeze(Object.fromEntries(loaded.map((agentPackage) => [agentPackage.seat, agentPackage]))) as Readonly<Record<OneChatSeat, OneChatAgentPackage>>
}

export interface BoundToolGroups {
  readonly tools: readonly AgentTool[]
  readonly compact: boolean
}

/** Bind only capabilities named by a validated package manifest. */
export function bindToolGroups(
  requested: readonly OneChatToolGroupName[],
  available: Readonly<Partial<Record<Exclude<OneChatToolGroupName, 'compact'>, readonly AgentTool[]>>>,
): BoundToolGroups {
  const tools: AgentTool[] = []
  for (const name of requested) {
    if (name === 'compact') continue
    const group = available[name]
    if (!group) throw new Error(`host tool group ${JSON.stringify(name)} is not configured`)
    tools.push(...group)
  }
  return { tools, compact: requested.includes('compact') }
}
