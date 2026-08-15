import { lstat, readFile, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { materializeAgentDirectory } from './materializeAgentDirectory'
import { createConfiguredAgentHostAgentSpec } from './createConfiguredAgentHostAgentSpec'
import { sha256 } from '../../shared/digest'
import { ErrorCode, type ErrorCode as AgentErrorCode } from '../../shared/error-codes'
import { AGENT_USER_FILESYSTEM_ID } from '../agent-host/types'
import type { AgentInstructionFileRef, ConfiguredAgentHostAgentSpec } from '../agent-host/types'
import type { Sha256Digest } from '../../shared/digest'

export interface ModelTierCandidate {
  readonly provider: string
  readonly id: string
  readonly envVar: string
}

type ModelTierCandidates = Readonly<Record<string, readonly ModelTierCandidate[]>>

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
  /**
   * Root of the workspace the `user` filesystem serves, or `null` when the
   * host resolves a DIFFERENT root per request (core, the CLI hub) and so has
   * no single one at fleet-composition time.
   *
   * Required, because published `instructionFiles` are addressed relative to
   * it and only the caller knows it. It is NOT derivable from the discovered
   * package roots: a fleet can be composed from packages that live outside
   * the workspace root, and guessing produced well-formed paths that
   * resolved to nothing.
   *
   * `null` is not a soft option — it makes the host structurally unable to
   * publish a ref it cannot guarantee, which is the honest answer for
   * per-workspace roots.
   */
  readonly workspaceRoot: string | null
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

/**
 * Whether a workspace-relative path is safe to publish to a client.
 *
 * Deliberately the SAME shape as the browser-side guard every openable
 * resource passes through (`isSafePluginRelativePath` +
 * `openableFileResource` in @hachej/boring-workspace): no NUL, no backslash,
 * percent-encoded dot/slash/backslash, scheme prefix, absolute path, or
 * `..`/empty/bare-dot segment. An allowlist regex here was stricter than the
 * guard downstream, so an ordinary seat name containing a space permanently
 * lost its link for no security reason.
 */
function isPublishableWorkspacePath(value: string): boolean {
  return value.length > 0
    && !value.includes('\0')
    && !value.includes('\\')
    && !value.startsWith('/')
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !/%(?:2e|2f|5c)/i.test(value)
    && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    && !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
}

export type FleetLoaderDiagnosticCode = Extract<
  AgentErrorCode,
  | 'AGENT_FLEET_SEAT_PERSONA_INVALID'
  | 'AGENT_FLEET_SEAT_SKILL_DIGEST_MISMATCH'
  | 'AGENT_DEFINITION_ID_CONFLICT'
  | 'AGENT_DEFINITION_UNSEATED'
  | 'AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE'
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

/**
 * A roster-authorized package is part of host configuration, not optional
 * discovery. Invalid configured seats therefore abort boot instead of being
 * silently omitted from the fleet.
 */
export class ConfiguredFleetSeatError extends Error {
  readonly code: FleetLoaderDiagnosticCode
  readonly seat: string
  readonly agentTypeId: string

  constructor(input: {
    code: FleetLoaderDiagnosticCode
    seat: string
    agentTypeId: string
    message: string
    cause?: unknown
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'ConfiguredFleetSeatError'
    this.code = input.code
    this.seat = input.seat
    this.agentTypeId = input.agentTypeId
  }
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

function isCanonicalPathInside(root: string, target: string): boolean {
  const fromRoot = relative(root, target)
  return fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
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

const ENV_VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function parseModelTierCandidates(raw: unknown, path: string): ModelTierCandidates {
  const name = basename(path)
  const models = isRecord(raw) ? raw.models : undefined
  const tiers = isRecord(models) ? models.tiers : undefined
  if (!isRecord(tiers) || Object.keys(tiers).length === 0) {
    throw new FleetConfigError({
      field: 'models.tiers',
      message: `${name} must declare a non-empty "models.tiers" mapping`,
    })
  }

  const result: Record<string, readonly ModelTierCandidate[]> = {}
  for (const [tier, entries] of Object.entries(tiers)) {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new FleetConfigError({
        field: `models.tiers.${tier}`,
        message: `${name} models.tiers.${tier} must be a non-empty candidate array`,
      })
    }
    result[tier] = Object.freeze(entries.map((entry, index) => {
      if (
        !isRecord(entry) ||
        !isNonBlankString(entry.provider) ||
        !isNonBlankString(entry.id) ||
        typeof entry.envVar !== 'string' || !ENV_VAR_RE.test(entry.envVar)
      ) {
        throw new FleetConfigError({
          field: `models.tiers.${tier}[${index}]`,
          message: `${name} models.tiers.${tier}[${index}] must have non-empty provider and id strings plus a valid envVar`,
        })
      }
      return Object.freeze({ provider: entry.provider, id: entry.id, envVar: entry.envVar })
    }))
  }
  return Object.freeze(result)
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

function validateSeatTierCandidates(
  seatTiers: Readonly<Record<string, string>>,
  modelTierCandidates: ModelTierCandidates,
  fleetConfigPath: string,
  policyPath: string,
): void {
  for (const [seat, tier] of Object.entries(seatTiers)) {
    if (modelTierCandidates[tier] === undefined) {
      throw new FleetConfigError({
        field: `models.tiers.${tier}`,
        message: `${basename(policyPath)} models.seats.${seat} references tier ${JSON.stringify(tier)}, which is missing from ${basename(fleetConfigPath)} models.tiers`,
      })
    }
  }
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

/** First configured model in `tier` whose API key is present, otherwise undefined. */
export function resolveSeatModel(
  tier: string | undefined,
  env: NodeJS.ProcessEnv,
  modelTierCandidates: ModelTierCandidates,
): string | undefined {
  if (tier === undefined) return undefined
  const candidates = modelTierCandidates[tier]
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
  if (!isCanonicalPathInside(rootTarget, target)) throw new Error('skill source resolves outside its admitted root')
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
 * descriptors, `.agents/factory/policy.yaml` `models.seats` tiers, and the
 * priority-ordered `models.tiers` candidates declared in fleet.yaml.
 *
 * Invalid unseated discovery remains optional and is excluded with a stable
 * diagnostic. Once a roster seat names a package, however, schema,
 * preflight, conflict, materialization, and digest failures throw
 * `ConfiguredFleetSeatError` and abort host boot. Whole-fleet config errors
 * (an unreadable/malformed fleet.yaml or policy.yaml) throw `FleetConfigError`.
 */
export async function loadConfiguredAgentFleet(
  options: LoadConfiguredAgentFleetOptions,
): Promise<LoadConfiguredAgentFleetResult> {
  const env = options.env ?? process.env
  const fleetRaw = await readYamlFile(options.fleetConfigPath, 'fleetConfigPath')
  const seats = parseFleetConfig(fleetRaw, options.fleetConfigPath)
  const modelTierCandidates = parseModelTierCandidates(fleetRaw, options.fleetConfigPath)

  let seatTiers: Readonly<Record<string, string>> = Object.freeze({})
  try {
    seatTiers = parseSeatTiers(await readYamlFile(options.policyPath, 'policyPath'))
  } catch {
    // Model-tier resolution is best-effort: an unreadable/malformed policy
    // file omits preferred models for every seat rather than failing boot.
    seatTiers = Object.freeze({})
  }
  validateSeatTierCandidates(seatTiers, modelTierCandidates, options.fleetConfigPath, options.policyPath)

  // Resolve the served root once, but keep failure per-seat and fail-closed:
  // composition can still proceed while publication reports the existing
  // stable unpublishable diagnostic.
  const canonicalWorkspaceRoot = options.workspaceRoot === null
    ? null
    : await realpath(resolve(options.workspaceRoot)).catch(() => null)

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
      const configuredSeat = seats.find((seat) => seat.agentTypeId === definitionId)
      if (configuredSeat) {
        throw new ConfiguredFleetSeatError({
          code: ErrorCode.enum.AGENT_DEFINITION_ID_CONFLICT,
          seat: configuredSeat.seat,
          agentTypeId: definitionId,
          message: `configured agent definition "${definitionId}" is claimed by multiple discovered packages`,
        })
      }
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
    try {
      const descriptors = packagesByDefinitionId.get(binding.agentTypeId) ?? []
      if (conflictedDefinitionIds.has(binding.agentTypeId)) continue
      const descriptor = descriptors[0]
      if (!descriptor || !descriptor.preflight.ok) throw new Error(`seat "${binding.seat}" has no valid discovered agent package`)
      // Canonicalize the discovered package root once: everything after this
      // point (composition, skill reads, publication path algebra) consumes
      // the admitted canonical directory, so directory symlinks cannot make a
      // published ref point somewhere the served root does not cover.
      const personaSource = await realpath(resolve(descriptor.rootDir))
      const source = await materializeAgentDirectory({
        directory: personaSource,
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
        throw new ConfiguredFleetSeatError({
          seat: binding.seat,
          agentTypeId: binding.agentTypeId,
          code: ErrorCode.enum.AGENT_FLEET_SEAT_SKILL_DIGEST_MISMATCH,
          message: `seat "${binding.seat}" skill pins do not exactly match its package pi.skills declarations`,
        })
      }

      const instructionAppendices: { name: string; digest: Sha256Digest; content: string }[] = []
      for (const skill of binding.skills) {
        let content: string
        try {
          content = skill.name.includes('/')
            ? await packageSkillContent(personaSource, skill)
            : await canonicalSkillContent(options.skillsRoot, skill)
        } catch (error) {
          throw new ConfiguredFleetSeatError({
            seat: binding.seat,
            agentTypeId: binding.agentTypeId,
            code: ErrorCode.enum.AGENT_FLEET_SEAT_SKILL_DIGEST_MISMATCH,
            message: error instanceof Error ? error.message : `skill "${skill.name}" is unavailable`,
            cause: error,
          })
        }
        const appendixName = skill.name.includes('/')
          ? `package-${instructionAppendices.length + 1}-${skill.digest.slice('sha256:'.length, 'sha256:'.length + 12)}`
          : skill.name
        instructionAppendices.push({ name: appendixName, digest: skill.digest, content })
      }

      const preferredModel = resolveSeatModel(seatTiers[binding.seat], env, modelTierCandidates)
      // The loader is the only place that knows seat -> persona directory;
      // publishing it here keeps clients from inverting the mapping.
      let instructionFiles: AgentInstructionFileRef[] | undefined
      const personaIsInsideWorkspace = canonicalWorkspaceRoot !== null
        && isCanonicalPathInside(canonicalWorkspaceRoot, personaSource)
      const publishedInstructionPath = canonicalWorkspaceRoot === null
        ? ''
        : relative(canonicalWorkspaceRoot, resolve(personaSource, 'instructions.md')).split(sep).join('/')
      // EXISTENCE is already proven and is deliberately not re-checked: this
      // seat only got here because `materializeAgentDirectory` read
      // `<personasDir>/<seat>/instructions.md` and rejected it if absent or
      // blank. A `stat` here would re-assert what composition just did.
      //
      // REACHABILITY is the only open question, and it is pure path algebra
      // against the served root — no I/O, no per-request probe. ONE honest
      // failure path covers both ways a ref can be unreachable: personas
      // outside the served workspace, and a composed path the client-side
      // guard would reject anyway.
      //
      // Together those two make publication deterministic: a published ref
      // names a file that exists, under the root the client reads through.
      const unpublishableReason = options.workspaceRoot === null
        ? `this host resolves a workspace root per request, so persona instructions have no single "${AGENT_USER_FILESYSTEM_ID}" path to be addressed against`
        : canonicalWorkspaceRoot === null || !personaIsInsideWorkspace
        ? `persona source for seat ${JSON.stringify(binding.seat)} resolves outside the workspace root ${JSON.stringify(options.workspaceRoot)} that the "${AGENT_USER_FILESYSTEM_ID}" filesystem serves`
        : !isPublishableWorkspacePath(publishedInstructionPath)
          ? `seat "${binding.seat}" composes an unsafe workspace-relative path (${JSON.stringify(publishedInstructionPath)})`
          : undefined
      if (unpublishableReason) {
        // Fails loud, not silent: the seat still composes, but the overlay
        // gets no instruction row and the operator gets a stable code.
        diagnostics.push({
          seat: binding.seat,
          agentTypeId: binding.agentTypeId,
          code: ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE,
          message: `${unpublishableReason}; its persona instructions will not be linkable`,
        })
      } else {
        instructionFiles = [{
          filesystem: AGENT_USER_FILESYSTEM_ID,
          path: publishedInstructionPath,
          role: 'persona',
        }]
      }
      const spec = await createConfiguredAgentHostAgentSpec({
        source,
        policy: {
          instructionAppendices,
          ...(instructionFiles ? { instructionFiles } : {}),
          ...(preferredModel ? { preferredModel } : {}),
        },
      })
      agents.push(spec)
    } catch (error) {
      if (error instanceof ConfiguredFleetSeatError) throw error
      throw new ConfiguredFleetSeatError({
        seat: binding.seat,
        agentTypeId: binding.agentTypeId,
        code: ErrorCode.enum.AGENT_FLEET_SEAT_PERSONA_INVALID,
        message: error instanceof Error ? error.message : `seat "${binding.seat}" persona is invalid`,
        cause: error,
      })
    }
  }

  return Object.freeze({ agents: Object.freeze(agents), diagnostics: Object.freeze(diagnostics) })
}
