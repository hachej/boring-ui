import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { ErrorCode, type ErrorCode as AgentErrorCode } from '../../shared/error-codes'
import { AGENT_USER_FILESYSTEM_ID } from '../agent-host/types'
import type { AgentInstructionFileRef, AgentInstructionSource } from '../agent-host/types'

/** Whether `target` is `root` or lives under it, both already canonicalized. */
export function isCanonicalPathInside(root: string, target: string): boolean {
  const fromRoot = relative(root, target)
  return fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
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
export function isPublishableWorkspacePath(value: string): boolean {
  return value.length > 0
    && !value.includes('\0')
    && !value.includes('\\')
    && !value.startsWith('/')
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !/%(?:2e|2f|5c)/i.test(value)
    && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    && !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
}

export type InstructionRefWithholdingCode = Extract<
  AgentErrorCode,
  'AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE'
>

export interface WithheldInstructionRef {
  readonly code: InstructionRefWithholdingCode
  /** Host absolute path of the authored source that could not be addressed. */
  readonly absolutePath: string
  readonly message: string
}

export interface ResolvedInstructionFileRefs {
  readonly refs: readonly AgentInstructionFileRef[]
  readonly withheld: readonly WithheldInstructionRef[]
}

/**
 * Addresses authored instruction sources against the workspace root a SINGLE
 * request is served from, which is the only moment a multi-workspace host
 * (the CLI hub, core) knows one — composition time sees a fleet shared by
 * every workspace (gh-1189).
 *
 * Publication is deterministic and fails closed: a ref is emitted only when
 * the source canonically resolves inside the served root AND composes a path
 * the client-side openable-resource guard accepts. Anything else is withheld
 * with the stable `AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE` code, so
 * the invariant from #1176 holds: a rendered link always resolves.
 *
 * Canonicalization (not lexical containment) on BOTH sides is the point:
 * dotfile managers make a symlinked `.agents` ordinary, and a lexical check
 * would call `~/project/.agents -> ~/dotfiles/agents` "inside the workspace"
 * and publish a link the `user` filesystem cannot open.
 */
export async function resolveAgentInstructionFileRefs(input: {
  readonly sources: readonly AgentInstructionSource[] | undefined
  /** Root the `user` filesystem serves for THIS request, when the host resolved one. */
  readonly workspaceRoot: string | null | undefined
}): Promise<ResolvedInstructionFileRefs> {
  const sources = input.sources ?? []
  if (sources.length === 0) return Object.freeze({ refs: Object.freeze([]), withheld: Object.freeze([]) })

  const canonicalWorkspaceRoot = typeof input.workspaceRoot === 'string' && input.workspaceRoot.trim()
    ? await realpath(resolve(input.workspaceRoot)).catch(() => null)
    : null

  const refs: AgentInstructionFileRef[] = []
  const withheld: WithheldInstructionRef[] = []
  for (const source of sources) {
    if (canonicalWorkspaceRoot === null) {
      withheld.push({
        code: ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE,
        absolutePath: source.absolutePath,
        message: `this request resolves no readable workspace root, so persona instructions have no "${AGENT_USER_FILESYSTEM_ID}" path to be addressed against`,
      })
      continue
    }
    // EXISTENCE is already proven by composition (`materializeAgentDirectory`
    // read and rejected a missing/blank instructions.md), so this canonicalizes
    // for REACHABILITY only. A source that vanished since boot fails closed
    // here too, which is the honest answer.
    const canonicalSource = await realpath(resolve(source.absolutePath)).catch(() => null)
    if (canonicalSource === null || !isCanonicalPathInside(canonicalWorkspaceRoot, canonicalSource)) {
      withheld.push({
        code: ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE,
        absolutePath: source.absolutePath,
        message: `instruction source resolves outside the workspace root that the "${AGENT_USER_FILESYSTEM_ID}" filesystem serves for this request`,
      })
      continue
    }
    const path = relative(canonicalWorkspaceRoot, canonicalSource).split(sep).join('/')
    if (!isPublishableWorkspacePath(path)) {
      withheld.push({
        code: ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE,
        absolutePath: source.absolutePath,
        message: `instruction source composes an unsafe workspace-relative path (${JSON.stringify(path)})`,
      })
      continue
    }
    refs.push(Object.freeze({
      filesystem: AGENT_USER_FILESYSTEM_ID,
      path,
      role: source.role,
    }))
  }
  return Object.freeze({ refs: Object.freeze(refs), withheld: Object.freeze(withheld) })
}
