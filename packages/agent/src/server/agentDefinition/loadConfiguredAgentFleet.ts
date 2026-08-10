import { lstat, readFile, realpath } from 'node:fs/promises'
import { basename, isAbsolute, dirname, relative, resolve, sep } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { materializeAgentDirectory } from './materializeAgentDirectory'
import { createConfiguredAgentHostAgentSpec } from './createConfiguredAgentHostAgentSpec'
import { sha256 } from '../../shared/digest'
import { ErrorCode, type ErrorCode as AgentErrorCode } from '../../shared/error-codes'
import { AGENT_USER_FILESYSTEM_ID } from '../agent-host/types'
import type { AgentInstructionFileRef, ConfiguredAgentHostAgentSpec } from '../agent-host/types'
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
 *
 * Each tier is PRIORITY-ORDERED and resolution takes the first candidate whose
 * `envVar` is present in the host process, so the fallback is a funding
 * fallback: a host with no Anthropic key still seats every tier on the
 * provider it can actually pay for. Before gh-1187 S0 this map was
 * Anthropic-only, which meant a Google-funded instance composed every seat
 * with NO resolved model and silently fell through to the host default — the
 * tier ladder in policy.yaml was decorative there (#1195).
 */
export interface ModelTierCandidate {
  readonly provider: string
  readonly id: string
  readonly envVar: string
}

export const MODEL_TIER_CANDIDATES: Readonly<Record<string, readonly ModelTierCandidate[]>> = Object.freeze({
  T1: [
    { provider: 'anthropic', id: 'claude-fable-5', envVar: 'ANTHROPIC_API_KEY' },
    { provider: 'google', id: 'gemini-3.1-pro-preview', envVar: 'GEMINI_API_KEY' },
  ],
  T2: [
    { provider: 'anthropic', id: 'claude-opus-4-8', envVar: 'ANTHROPIC_API_KEY' },
    { provider: 'google', id: 'gemini-3.1-pro-preview', envVar: 'GEMINI_API_KEY' },
  ],
  T3: [
    { provider: 'anthropic', id: 'claude-sonnet-4-6', envVar: 'ANTHROPIC_API_KEY' },
    { provider: 'google', id: 'gemini-3-pro-preview', envVar: 'GEMINI_API_KEY' },
  ],
  T4: [
    { provider: 'anthropic', id: 'claude-haiku-4-5-20251001', envVar: 'ANTHROPIC_API_KEY' },
    { provider: 'google', id: 'gemini-3.5-flash', envVar: 'GEMINI_API_KEY' },
  ],
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

export interface LoadConfiguredAgentFleetOptions {
  /**
   * Root of the workspace the `user` filesystem serves, or `null` when the
   * host resolves a DIFFERENT root per request (core, the CLI hub) and so has
   * no single one at fleet-composition time.
   *
   * Required, because published `instructionFiles` are addressed relative to
   * it and only the caller knows it. It is NOT derivable from `personasDir`:
   * a fleet can be composed from a repository root that is not the workspace
   * root, and guessing "the last two segments" produced well-formed paths
   * that resolved to nothing.
   *
   * `null` is not a soft option — it makes the host structurally unable to
   * publish a ref it cannot guarantee, which is the honest answer for
   * per-workspace roots.
   */
  readonly workspaceRoot: string | null
  /** Directory containing `<seat>/package.json` persona packages. */
  readonly personasDir: string
  /** Path to `.agents/factory/fleet.yaml`. */
  readonly fleetConfigPath: string
  /** Path to `.agents/factory/policy.yaml` (read for `models.seats` tiers). */
  readonly policyPath: string
  /**
   * Directory containing `<skill>/SKILL.md` canonical skill sources.
   * Defaults to the `skills` directory sibling of `personasDir` (i.e.
   * `.agents/skills` next to `.agents/personas`) — override when that
   * sibling-directory layout assumption doesn't hold (e.g. isolated fixture
   * trees that don't mirror the full `.agents/` shape).
   */
  readonly skillsRoot?: string
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
  | 'AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE'
>

export interface FleetLoaderDiagnostic {
  readonly seat: string
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

function isCanonicalPathInside(root: string, target: string): boolean {
  const fromRoot = relative(root, target)
  return fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
}

async function admitPersonaSource(personasDir: string, seat: string): Promise<string> {
  const canonicalRoot = await realpath(resolve(personasDir))
  const canonicalSource = await realpath(resolve(personasDir, seat))
  if (!isCanonicalPathInside(canonicalRoot, canonicalSource)) {
    throw new Error(`seat "${seat}" persona source resolves outside the configured personas directory`)
  }
  return canonicalSource
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

async function canonicalSkillContent(skillsRoot: string, skill: FleetSkillBinding): Promise<string> {
  const candidate = resolve(skillsRoot, skill.name, 'SKILL.md')
  try {
    const fileStat = await lstat(candidate)
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new Error(`canonical skill "${skill.name}" must be a regular non-symlink file`)
    }
    const [canonicalSkillsRoot, target] = await Promise.all([
      realpath(resolve(skillsRoot)),
      realpath(candidate),
    ])
    if (!isCanonicalPathInside(canonicalSkillsRoot, target)) {
      throw new Error(`canonical skill "${skill.name}" resolves outside the admitted skills root`)
    }
    const content = await readFile(target, 'utf8')
    const digest = await sha256(content)
    if (digest !== skill.digest) {
      throw new Error(`canonical skill "${skill.name}" digest mismatch`)
    }
    return content
  } catch {
    // Redact filesystem paths/causes from the diagnostic surface.
    throw new Error(`canonical skill "${skill.name}" is unavailable`)
  }
}

/**
 * Loads the config-driven production/CLI agent fleet: `.agents/factory/fleet.yaml`
 * seat → skill-digest bindings, `.agents/personas/<seat>` plugin-shaped persona
 * packages, and `.agents/factory/policy.yaml` `models.seats` tiers resolved via
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

  const skillsRoot = options.skillsRoot ?? resolve(dirname(options.personasDir), 'skills')
  // Resolve the served root once, but keep failure per-seat and fail-closed:
  // composition can still proceed while publication reports the existing
  // stable unpublishable diagnostic.
  const canonicalWorkspaceRoot = options.workspaceRoot === null
    ? null
    : await realpath(resolve(options.workspaceRoot)).catch(() => null)

  const agents: ConfiguredAgentHostAgentSpec[] = []
  const diagnostics: FleetLoaderDiagnostic[] = []

  for (const binding of seats) {
    let recorded = false
    try {
      // This is the filesystem-adapter boundary for configured personas. The
      // raw seat is used only to locate a candidate; everything after this
      // point consumes the admitted canonical directory. That prevents both
      // `..` and directory-symlink escapes from becoming composition roots.
      const personaSource = await admitPersonaSource(options.personasDir, binding.seat)
      const source = await materializeAgentDirectory({
        directory: personaSource,
        expectedAgentTypeId: binding.agentTypeId,
        manifest: 'package.json',
      })

      const instructionAppendices: { name: string; digest: Sha256Digest; content: string }[] = []
      for (const skill of binding.skills) {
        let content: string
        try {
          content = await canonicalSkillContent(skillsRoot, skill)
        } catch (error) {
          recorded = true
          diagnostics.push({
            seat: binding.seat,
            code: ErrorCode.enum.AGENT_FLEET_SEAT_SKILL_DIGEST_MISMATCH,
            message: error instanceof Error ? error.message : `skill "${skill.name}" is unavailable`,
          })
          throw error
        }
        instructionAppendices.push({ name: skill.name, digest: skill.digest, content })
      }

      const preferredModel = resolveSeatModel(seatTiers[binding.seat], env)
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
      if (!recorded) {
        diagnostics.push({
          seat: binding.seat,
          code: ErrorCode.enum.AGENT_FLEET_SEAT_PERSONA_INVALID,
          message: error instanceof Error ? error.message : `seat "${binding.seat}" persona is invalid`,
        })
      }
    }
  }

  return Object.freeze({ agents: Object.freeze(agents), diagnostics: Object.freeze(diagnostics) })
}
