import { lstat, readFile, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { materializeAgentDirectory } from './materializeAgentDirectory'
import { createConfiguredAgentHostAgentSpec } from './createConfiguredAgentHostAgentSpec'
import { sha256 } from '../../shared/digest'
import { ErrorCode, type ErrorCode as AgentErrorCode } from '../../shared/error-codes'
import type { ConfiguredAgentHostAgentSpec } from '../agent-host/types'
import type { Sha256Digest } from '../../shared/digest'

/**
 * Tier → seat-eligible-model priority. Hand-maintained per
 * docs/procedures/MODEL-CARD.md's priority-ordered tier table — deliberately
 * NOT parsed from the markdown (the card is prose/rationale, this is the
 * compiled fact). Keep the two in sync by hand when the card changes.
 *
 * Only models that can hold a pi-native AgentHost seat are listed. The card's
 * Sol (codex-exec cross-model pass) and Terra/Luna (codex bulk/mechanical)
 * are explicitly out — the card states they "cannot hold a seat" / "cannot
 * hold a pi session".
 */
export interface ModelTierCandidate {
  readonly provider: string
  readonly id: string
  readonly envVar: string
}

export const MODEL_TIER_CANDIDATES: Readonly<Record<string, readonly ModelTierCandidate[]>> = Object.freeze({
  T1: [{ provider: 'anthropic', id: 'claude-fable-5', envVar: 'ANTHROPIC_API_KEY' }],
  T2: [{ provider: 'anthropic', id: 'claude-opus-4-8', envVar: 'ANTHROPIC_API_KEY' }],
  T3: [{ provider: 'anthropic', id: 'claude-sonnet-4-6', envVar: 'ANTHROPIC_API_KEY' }],
  T4: [{ provider: 'anthropic', id: 'claude-haiku-4-5-20251001', envVar: 'ANTHROPIC_API_KEY' }],
})

export interface FleetSkillBinding {
  readonly name: string
  readonly digest: Sha256Digest
}

export interface FleetSeatBinding {
  readonly seat: string
  readonly agentTypeId: string
  readonly skills: readonly FleetSkillBinding[]
}

export interface DiscoveredAgentPackageDescriptor {
  readonly rootDir: string
  readonly manifest: {
    readonly boring: {
      readonly agent: {
        readonly definitionId: string
        readonly version: string
        readonly label?: string
        readonly description?: string
        readonly instructionsRef: string
      }
    }
    readonly pi?: { readonly skills?: readonly string[] }
  }
  readonly preflight: {
    readonly ok: boolean
    readonly errors?: readonly { readonly code: string; readonly message: string }[]
  }
}

export interface LoadConfiguredAgentFleetOptions {
  /** Plugin-manager scan descriptors injected by the workspace/CLI boot layer. */
  readonly discoveredPackages: readonly DiscoveredAgentPackageDescriptor[]
  /** Path to `.agents/factory/fleet.yaml`. */
  readonly fleetConfigPath: string
  /** Path to `.agents/factory/policy.yaml` (read for `models.seats` tiers). */
  readonly policyPath: string
  /**
   * Directory containing `<skill>/SKILL.md` canonical skill sources.
   * This root is host-owned because shared skill names are not package paths.
   */
  readonly skillsRoot: string
  /** Overridable for tests; defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
}

export type FleetLoaderDiagnosticCode = Extract<
  AgentErrorCode,
  | 'AGENT_FLEET_SEAT_PERSONA_INVALID'
  | 'AGENT_FLEET_SEAT_SKILL_DIGEST_MISMATCH'
  | 'AGENT_DEFINITION_ID_CONFLICT'
  | 'AGENT_DEFINITION_UNSEATED'
>

export interface FleetLoaderDiagnostic {
  readonly seat?: string
  readonly agentTypeId: string
  readonly code: FleetLoaderDiagnosticCode
  readonly message: string
}

export interface LoadConfiguredAgentFleetResult {
  readonly agents: readonly ConfiguredAgentHostAgentSpec[]
  readonly diagnostics: readonly FleetLoaderDiagnostic[]
}

export type FleetConfigErrorCode = Extract<AgentErrorCode, 'AGENT_FLEET_CONFIG_FILE_INVALID'>

/** Thrown for whole-fleet configuration failures (not per-seat, fail-closed). */
export class FleetConfigError extends Error {
  readonly code: FleetConfigErrorCode
  readonly field: string

  constructor(input: { field: string; message: string; cause?: unknown }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'FleetConfigError'
    this.code = ErrorCode.enum.AGENT_FLEET_CONFIG_FILE_INVALID
    this.field = input.field
  }
}

function isInside(root: string, target: string): boolean {
  const fromRoot = relative(root, target)
  return fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const SHA256_RE = /^sha256:[0-9a-f]{64}$/

function parseFleetConfig(raw: unknown, path: string): readonly FleetSeatBinding[] {
  const name = basename(path)
  if (!isRecord(raw) || !Array.isArray(raw.seats)) {
    throw new FleetConfigError({ field: 'seats', message: `${name} must declare a "seats" array` })
  }
  return raw.seats.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.seat !== 'string' ||
      typeof entry.agentTypeId !== 'string' ||
      !Array.isArray(entry.skills)
    ) {
      throw new FleetConfigError({
        field: `seats[${index}]`,
        message: `${name} seats[${index}] must have seat, agentTypeId, and skills`,
      })
    }
    const skills = entry.skills.map((skill, skillIndex) => {
      if (!isRecord(skill) || typeof skill.name !== 'string' || typeof skill.digest !== 'string' || !SHA256_RE.test(skill.digest)) {
        throw new FleetConfigError({
          field: `seats[${index}].skills[${skillIndex}]`,
          message: `${name} seats[${index}].skills[${skillIndex}] must have a name and a sha256:... digest`,
        })
      }
      return Object.freeze({ name: skill.name, digest: skill.digest as Sha256Digest })
    })
    return Object.freeze({ seat: entry.seat, agentTypeId: entry.agentTypeId, skills: Object.freeze(skills) })
  })
}

function parseSeatTiers(raw: unknown): Readonly<Record<string, string>> {
  if (!isRecord(raw)) return Object.freeze({})
  const models = raw.models
  if (!isRecord(models)) return Object.freeze({})
  const seats = models.seats
  if (!isRecord(seats)) return Object.freeze({})
  const result: Record<string, string> = {}
  for (const [seat, tier] of Object.entries(seats)) {
    if (typeof tier === 'string') result[seat] = tier
  }
  return Object.freeze(result)
}

async function readYamlFile(path: string, field: string): Promise<unknown> {
  const name = basename(path)
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    // Redact the absolute filesystem path from the diagnostic surface; the
    // cause (not surfaced in messages/logs by default) retains it for
    // programmatic callers that need it.
    throw new FleetConfigError({ field, message: `${name} could not be read`, cause: error })
  }
  try {
    return parseYaml(content)
  } catch (error) {
    throw new FleetConfigError({ field, message: `${name} is not valid YAML`, cause: error })
  }
}

/** First available model in `tier`, or undefined if no candidate's API key is present. */
function resolveSeatModel(tier: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  if (tier === undefined) return undefined
  const candidates = MODEL_TIER_CANDIDATES[tier]
  if (!candidates) return undefined
  for (const candidate of candidates) {
    if (env[candidate.envVar]) return `${candidate.provider}:${candidate.id}`
  }
  return undefined
}

async function readVerifiedSkillContent(
  root: string,
  reference: string,
  skill: FleetSkillBinding,
): Promise<string> {
  const rootTarget = await realpath(root)
  let candidate = resolve(rootTarget, reference)
  const candidateStat = await lstat(candidate)
  if (candidateStat.isDirectory()) candidate = resolve(candidate, 'SKILL.md')
  const fileStat = await lstat(candidate)
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error('skill source is not a regular file')
  const target = await realpath(candidate)
  if (!isInside(rootTarget, target)) throw new Error('skill source resolves outside its admitted root')
  const content = await readFile(target, 'utf8')
  if (await sha256(content) !== skill.digest) throw new Error('skill digest mismatch')
  return content
}

async function canonicalSkillContent(skillsRoot: string, skill: FleetSkillBinding): Promise<string> {
  try {
    return await readVerifiedSkillContent(skillsRoot, `${skill.name}/SKILL.md`, skill)
  } catch {
    throw new Error(`canonical skill "${skill.name}" is unavailable`)
  }
}

async function packageSkillContent(packageRoot: string, skill: FleetSkillBinding): Promise<string> {
  try {
    return await readVerifiedSkillContent(packageRoot, skill.name, skill)
  } catch {
    throw new Error(`package skill "${skill.name}" is unavailable`)
  }
}

/**
 * Loads the config-driven production/CLI agent fleet: `.agents/factory/fleet.yaml`
 * seat → skill-digest bindings, boot-injected plugin-shaped persona package
 * descriptors, and `.agents/factory/policy.yaml` `models.seats` tiers resolved via
 * the hardcoded MODEL-CARD priority map above.
 *
 * Fails closed per seat: a persona that fails materialization, digest
 * verification, or spec composition is excluded with a stable diagnostic —
 * the remaining valid seats still compose. Whole-fleet config errors (an
 * unreadable/malformed fleet.yaml or policy.yaml) throw `FleetConfigError`,
 * since there is no seat set to fail closed against.
 */
export async function loadConfiguredAgentFleet(
  options: LoadConfiguredAgentFleetOptions,
): Promise<LoadConfiguredAgentFleetResult> {
  const env = options.env ?? process.env
  const fleetRaw = await readYamlFile(options.fleetConfigPath, 'fleetConfigPath')
  const seats = parseFleetConfig(fleetRaw, options.fleetConfigPath)

  let seatTiers: Readonly<Record<string, string>> = Object.freeze({})
  try {
    seatTiers = parseSeatTiers(await readYamlFile(options.policyPath, 'policyPath'))
  } catch {
    // Model-tier resolution is best-effort: an unreadable/malformed policy
    // file omits preferred models for every seat rather than failing boot.
    seatTiers = Object.freeze({})
  }

  const agents: ConfiguredAgentHostAgentSpec[] = []
  const diagnostics: FleetLoaderDiagnostic[] = []
  const packagesByDefinitionId = new Map<string, DiscoveredAgentPackageDescriptor[]>()
  for (const descriptor of options.discoveredPackages) {
    const definitionId = descriptor.manifest.boring.agent.definitionId
    const existing = packagesByDefinitionId.get(definitionId) ?? []
    existing.push(descriptor)
    packagesByDefinitionId.set(definitionId, existing)
  }
  const seatedDefinitionIds = new Set(seats.map((seat) => seat.agentTypeId))
  const conflictedDefinitionIds = new Set<string>()
  for (const [definitionId, descriptors] of packagesByDefinitionId) {
    if (descriptors.length > 1) {
      conflictedDefinitionIds.add(definitionId)
      for (const _descriptor of descriptors) {
        diagnostics.push({
          agentTypeId: definitionId,
          code: ErrorCode.enum.AGENT_DEFINITION_ID_CONFLICT,
          message: `agent definition "${definitionId}" is claimed by multiple discovered packages`,
        })
      }
    } else if (!seatedDefinitionIds.has(definitionId)) {
      const descriptor = descriptors[0]!
      diagnostics.push(descriptor.preflight.ok ? {
        agentTypeId: definitionId,
        code: ErrorCode.enum.AGENT_DEFINITION_UNSEATED,
        message: `discovered agent definition "${definitionId}" is not seated and remains inert`,
      } : {
        agentTypeId: definitionId,
        code: ErrorCode.enum.AGENT_FLEET_SEAT_PERSONA_INVALID,
        message: `discovered agent definition "${definitionId}" failed plugin preflight and is excluded`,
      })
    }
  }

  for (const binding of seats) {
    let recorded = false
    try {
      const descriptors = packagesByDefinitionId.get(binding.agentTypeId) ?? []
      if (conflictedDefinitionIds.has(binding.agentTypeId)) continue
      const descriptor = descriptors[0]
      if (!descriptor || !descriptor.preflight.ok) throw new Error(`seat "${binding.seat}" has no valid discovered agent package`)
      const source = await materializeAgentDirectory({
        directory: descriptor.rootDir,
        expectedAgentTypeId: binding.agentTypeId,
        manifest: 'package.json',
      })

      const declaredSkills = descriptor.manifest.pi?.skills ?? []
      const declaredSet = new Set(declaredSkills)
      const pinnedSet = new Set(binding.skills.map((skill) => skill.name))
      if (
        declaredSet.size !== declaredSkills.length ||
        pinnedSet.size !== binding.skills.length ||
        declaredSet.size !== pinnedSet.size ||
        [...declaredSet].some((name) => !pinnedSet.has(name))
      ) {
        recorded = true
        diagnostics.push({
          seat: binding.seat,
          agentTypeId: binding.agentTypeId,
          code: ErrorCode.enum.AGENT_FLEET_SEAT_SKILL_DIGEST_MISMATCH,
          message: `seat "${binding.seat}" skill pins do not exactly match its package pi.skills declarations`,
        })
        continue
      }

      const instructionAppendices: { name: string; digest: Sha256Digest; content: string }[] = []
      for (const skill of binding.skills) {
        let content: string
        try {
          content = skill.name.includes('/')
            ? await packageSkillContent(descriptor.rootDir, skill)
            : await canonicalSkillContent(options.skillsRoot, skill)
        } catch (error) {
          recorded = true
          diagnostics.push({
            seat: binding.seat,
            agentTypeId: binding.agentTypeId,
            code: ErrorCode.enum.AGENT_FLEET_SEAT_SKILL_DIGEST_MISMATCH,
            message: error instanceof Error ? error.message : `skill "${skill.name}" is unavailable`,
          })
          throw error
        }
        const appendixName = skill.name.includes('/')
          ? `package-${instructionAppendices.length + 1}-${skill.digest.slice('sha256:'.length, 'sha256:'.length + 12)}`
          : skill.name
        instructionAppendices.push({ name: appendixName, digest: skill.digest, content })
      }

      const preferredModel = resolveSeatModel(seatTiers[binding.seat], env)
      const spec = await createConfiguredAgentHostAgentSpec({
        source,
        policy: {
          instructionAppendices,
          ...(preferredModel ? { preferredModel } : {}),
        },
      })
      agents.push(spec)
    } catch (error) {
      if (!recorded) {
        diagnostics.push({
          seat: binding.seat,
          agentTypeId: binding.agentTypeId,
          code: ErrorCode.enum.AGENT_FLEET_SEAT_PERSONA_INVALID,
          message: error instanceof Error ? error.message : `seat "${binding.seat}" persona is invalid`,
        })
      }
    }
  }

  return Object.freeze({ agents: Object.freeze(agents), diagnostics: Object.freeze(diagnostics) })
}
