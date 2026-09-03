import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FastifyInstance } from 'fastify'
import type { ToolExecContext, ToolResult } from '@hachej/boring-agent/shared'
import type { DemoEntry, FactoryDemoPluginControl } from './demoPlugin'
import type { FactorySupervisionPluginControl } from './supervisionPlugin'
import { invalidateAllEpicSnapshots } from './snapshotRegistry'

const execFileAsync = promisify(execFile)

export type PrLookupStatus = 'available' | 'gh-unavailable' | 'not-found' | 'error'

export interface FactoryPrStatus {
  readonly number: number
  readonly url: string
  readonly state: string
  readonly mergedAt: string | null
}

export interface FactoryPrLookup {
  readonly status: PrLookupStatus
  readonly message?: string
}

export interface FactoryStatusPrDetails {
  readonly pr: FactoryPrStatus | null
  readonly prLookup: FactoryPrLookup
}

export interface EpicClosurePullRequest {
  readonly number: number
  readonly url: string
  readonly state: string
  readonly mergedAt: string | null
  readonly mergeCommitSha: string | null
  readonly headRefName: string | null
  readonly headRefOid: string | null
  readonly headRepositoryName: string | null
  readonly headRepositoryOwnerLogin: string | null
  readonly isCrossRepository: boolean
}

export interface EpicClosureIssue {
  readonly id: string
  readonly title?: string
  readonly status?: string
  readonly assignee?: string | null
  readonly labels?: readonly string[]
}

export interface EpicClosureDemoStopOutcome {
  readonly id: string
  readonly sandboxId: string
  readonly status: 'stopped' | 'already-stopped' | 'failed'
  readonly sessionId?: string
  readonly error?: string
}

export interface EpicClosureBeadOutcome {
  readonly id: string
  readonly status: 'closed' | 'already-closed' | 'failed'
  readonly reason?: string
  readonly assignee?: string | null
  readonly workerSessionId?: string
  readonly error?: string
}

export interface EpicClosureCleanupOutcome {
  cleanupRequested: boolean
  snapshotRegistry?: {
    status: 'invalidated' | 'skipped' | 'failed'
    removedKeys?: string[]
    error?: string
  }
  branchDeletion?: {
    status: 'deleted' | 'already-absent' | 'skipped' | 'failed'
    branch: string
    headRefOid: string
    remote?: string
    reason?: string
    error?: string
  }
}

export interface EpicClosureReceipt {
  overall: 'complete' | 'partial'
  code?: string
  message?: string
  callingSessionId: string
  verifiedPr?: FactoryPrStatus & { readonly mergeCommitSha: string }
  workerSessionIds: string[]
  closedBeadIds: string[]
  alreadyClosedBeadIds: string[]
  demoOutcomes: EpicClosureDemoStopOutcome[]
  beadOutcomes: EpicClosureBeadOutcome[]
  cleanup: EpicClosureCleanupOutcome
  epicBead?: EpicClosureBeadOutcome
  supervision?: { readonly status: 'stopped' | 'already-stopped' | 'failed'; readonly error?: string }
}

export interface EpicClosureDeps {
  readonly workspaceRoot: string
  readonly epicKey: string
  readonly featureName: string
  readonly getApp: () => FastifyInstance | undefined
  readonly workspaceScopeId: string
  readonly demoControl: FactoryDemoPluginControl
  readonly supervisionControl: FactorySupervisionPluginControl
  readonly invalidateAllSnapshotsForEpic?: typeof invalidateAllEpicSnapshots
}

interface GhPrView {
  readonly number?: number
  readonly url?: string
  readonly state?: string
  readonly mergedAt?: string | null
  readonly mergeCommit?: { oid?: string | null } | null
  readonly headRefName?: string | null
  readonly headRefOid?: string | null
  readonly headRepository?: { name?: string | null } | null
  readonly headRepositoryOwner?: { login?: string | null } | null
  readonly isCrossRepository?: boolean | null
}

const GIT_REF_RE = /^(?!\/)(?!.*\/\.)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\/-]+$/

function textResult(details: Record<string, unknown>, isError: boolean): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(details) }], details, isError }
}

async function execJson(args: readonly string[], cwd: string): Promise<unknown> {
  const { stdout } = await execFileAsync(args[0]!, args.slice(1), { cwd, maxBuffer: 16 * 1024 * 1024 })
  return JSON.parse(stdout)
}

function parsePr(raw: unknown): EpicClosurePullRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const pr = raw as GhPrView
  if (typeof pr.number !== 'number' || typeof pr.url !== 'string' || typeof pr.state !== 'string') return null
  return {
    number: pr.number,
    url: pr.url,
    state: pr.state,
    mergedAt: typeof pr.mergedAt === 'string' ? pr.mergedAt : null,
    mergeCommitSha: typeof pr.mergeCommit?.oid === 'string' ? pr.mergeCommit.oid : null,
    headRefName: typeof pr.headRefName === 'string' ? pr.headRefName : null,
    headRefOid: typeof pr.headRefOid === 'string' ? pr.headRefOid : null,
    headRepositoryName: typeof pr.headRepository?.name === 'string' ? pr.headRepository.name : null,
    headRepositoryOwnerLogin: typeof pr.headRepositoryOwner?.login === 'string' ? pr.headRepositoryOwner.login : null,
    isCrossRepository: pr.isCrossRepository === true,
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'command failed'
}

export async function lookupFactoryPrStatus(workspaceRoot: string, branch: string): Promise<FactoryStatusPrDetails> {
  try {
    const parsed = await execJson([
      'gh', 'pr', 'view', branch,
      '--json', 'number,url,state,mergedAt,mergeCommit,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository',
    ], workspaceRoot)
    const pr = parsePr(parsed)
    if (!pr) return { pr: null, prLookup: { status: 'error', message: 'gh returned an invalid PR payload' } }
    return {
      pr: { number: pr.number, url: pr.url, state: pr.state, mergedAt: pr.mergedAt },
      prLookup: { status: 'available' },
    }
  } catch (error) {
    const message = safeMessage(error)
    if (message.includes('ENOENT')) return { pr: null, prLookup: { status: 'gh-unavailable', message: 'gh CLI is unavailable' } }
    if (/no pull requests found|could not resolve to a pull request/i.test(message)) {
      return { pr: null, prLookup: { status: 'not-found', message: 'no PR found for the epic branch' } }
    }
    return { pr: null, prLookup: { status: 'error', message } }
  }
}

async function readGitValue(workspaceRoot: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: workspaceRoot, maxBuffer: 16 * 1024 * 1024 })
  return stdout.trim()
}

async function loadAllEpicBeads(workspaceRoot: string, epicKey: string): Promise<EpicClosureIssue[]> {
  const parsed = await execJson(['br', 'list', '--all', '--label', `epic:${epicKey}`, '--json', '--no-auto-flush'], workspaceRoot)
  if (Array.isArray(parsed)) return parsed as EpicClosureIssue[]
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { issues?: unknown }).issues)) {
    return (parsed as { issues: EpicClosureIssue[] }).issues
  }
  return []
}

async function closeBead(workspaceRoot: string, issueId: string, reason: string): Promise<void> {
  await execFileAsync('br', ['close', issueId, '--reason', reason], { cwd: workspaceRoot, maxBuffer: 16 * 1024 * 1024 })
}

async function readRemoteOrigin(workspaceRoot: string): Promise<string> {
  return await readGitValue(workspaceRoot, ['remote', 'get-url', 'origin'])
}

async function readDefaultBranch(workspaceRoot: string): Promise<string | null> {
  try {
    const ref = await readGitValue(workspaceRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
    const prefix = 'refs/remotes/origin/'
    return ref.startsWith(prefix) ? ref.slice(prefix.length) : null
  } catch {
    return null
  }
}

async function remoteBranchExists(workspaceRoot: string, branch: string): Promise<boolean> {
  const { stdout } = await execFileAsync('git', ['ls-remote', '--heads', 'origin', branch], { cwd: workspaceRoot, maxBuffer: 16 * 1024 * 1024 })
  return stdout.trim().length > 0
}

function normalizeRemoteIdentity(remote: string): string | null {
  const trimmed = remote.trim().replace(/\.git$/i, '')
  const scpMatch = trimmed.match(/^[^@]+@([^:]+):(.+)$/)
  if (scpMatch) return `${scpMatch[1]}/${scpMatch[2]}`.toLowerCase()
  try {
    const url = new URL(trimmed)
    const path = url.pathname.replace(/^\/+/, '')
    return `${url.hostname}/${path}`.toLowerCase()
  } catch {
    return null
  }
}

function expectedPrRemote(pr: EpicClosurePullRequest): string | null {
  if (!pr.headRepositoryOwnerLogin || !pr.headRepositoryName) return null
  return `github.com/${pr.headRepositoryOwnerLogin}/${pr.headRepositoryName}`.toLowerCase()
}

export async function executeCloseEpic(
  params: Record<string, unknown>,
  ctx: ToolExecContext,
  deps: EpicClosureDeps,
): Promise<ToolResult> {
  const app = deps.getApp()
  if (!app) return textResult({ code: 'HOST_NOT_BOUND', message: 'close_epic is not bound to a running host' }, true)
  const prNumber = params.prNumber
  if (typeof prNumber !== 'number' || !Number.isInteger(prNumber) || prNumber <= 0) {
    return textResult({ code: 'INVALID_INPUT', message: 'prNumber must be a positive integer' }, true)
  }
  const cleanupRequested = params.cleanup === undefined ? true : params.cleanup === true
  if (params.cleanup !== undefined && typeof params.cleanup !== 'boolean') {
    return textResult({ code: 'INVALID_INPUT', message: 'cleanup must be a boolean when provided' }, true)
  }
  const callingSessionId = ctx.sessionId
  if (!callingSessionId) return textResult({ code: 'INVALID_INPUT', message: 'close_epic requires a known session id' }, true)

  try {
    const branch = await readGitValue(deps.workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const headSha = await readGitValue(deps.workspaceRoot, ['rev-parse', 'HEAD'])
    const branchPrLookup = await lookupFactoryPrStatus(deps.workspaceRoot, branch)
    if (branchPrLookup.prLookup.status === 'gh-unavailable') {
      return textResult({ code: 'PR_LOOKUP_UNAVAILABLE', message: branchPrLookup.prLookup.message, callingSessionId }, true)
    }
    if (branchPrLookup.prLookup.status !== 'available' || !branchPrLookup.pr) {
      return textResult({ code: 'PR_LOOKUP_FAILED', message: branchPrLookup.prLookup.message ?? 'failed to resolve PR for epic branch', callingSessionId }, true)
    }
    if (branchPrLookup.pr.number !== prNumber) {
      return textResult({ code: 'PR_NUMBER_MISMATCH', message: `epic branch maps to PR #${branchPrLookup.pr.number}, not #${prNumber}`, callingSessionId }, true)
    }

    const exactParsed = await execJson([
      'gh', 'pr', 'view', String(prNumber),
      '--json', 'number,url,state,mergedAt,mergeCommit,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository',
    ], deps.workspaceRoot)
    const verifiedPr = parsePr(exactParsed)
    if (!verifiedPr) return textResult({ code: 'PR_LOOKUP_FAILED', message: 'gh returned an invalid PR payload', callingSessionId }, true)
    if (verifiedPr.headRefName !== branch) {
      return textResult({ code: 'PR_HEAD_MISMATCH', message: `PR #${prNumber} head branch ${verifiedPr.headRefName ?? '(none)'} does not match ${branch}`, callingSessionId }, true)
    }
    if (verifiedPr.state !== 'MERGED' || !verifiedPr.mergedAt || !verifiedPr.mergeCommitSha) {
      return textResult({ code: 'PR_NOT_MERGED', message: `PR #${prNumber} is not merged`, callingSessionId }, true)
    }
    if (!verifiedPr.headRefOid) {
      return textResult({ code: 'PR_HEAD_REF_MISSING', message: `PR #${prNumber} is missing headRefOid`, callingSessionId }, true)
    }
    if (headSha !== verifiedPr.headRefOid) {
      return textResult({ code: 'PR_HEAD_SHA_MISMATCH', message: `workspace HEAD ${headSha} does not match PR head SHA ${verifiedPr.headRefOid}`, callingSessionId }, true)
    }
    const mergeCommitSha = verifiedPr.mergeCommitSha
    if (verifiedPr.isCrossRepository) {
      return textResult({ code: 'PR_CROSS_REPOSITORY', message: `PR #${prNumber} head repository is cross-repository`, callingSessionId }, true)
    }
    const originIdentity = normalizeRemoteIdentity(await readRemoteOrigin(deps.workspaceRoot))
    const prIdentity = expectedPrRemote(verifiedPr)
    if (!originIdentity || !prIdentity || originIdentity !== prIdentity) {
      return textResult({ code: 'PR_REPOSITORY_MISMATCH', message: `PR #${prNumber} head repository does not match origin`, callingSessionId }, true)
    }
    if (!GIT_REF_RE.test(branch) || branch === '.' || branch === '..') {
      return textResult({ code: 'INVALID_BRANCH_REF', message: `epic branch ${branch} is not eligible for remote cleanup`, callingSessionId }, true)
    }

    const beads = await loadAllEpicBeads(deps.workspaceRoot, deps.epicKey)
    const epicBeads = beads.filter((issue) => issue.id === `factory-${deps.epicKey}`)
    if (epicBeads.length !== 1) {
      return textResult({ code: 'EPIC_BEAD_NOT_UNIQUE', message: `expected exactly one epic Bead for ${deps.epicKey}`, callingSessionId }, true)
    }

    const receipt: EpicClosureReceipt = {
      overall: 'complete',
      callingSessionId,
      verifiedPr: {
        number: verifiedPr.number,
        url: verifiedPr.url,
        state: verifiedPr.state,
        mergedAt: verifiedPr.mergedAt,
        mergeCommitSha,
      },
      workerSessionIds: [...new Set(beads.map((issue) => issue.assignee).filter((v): v is string => typeof v === 'string' && v.length > 0 && v !== callingSessionId))],
      closedBeadIds: [],
      alreadyClosedBeadIds: [],
      demoOutcomes: [],
      beadOutcomes: [],
      cleanup: { cleanupRequested },
    }

    const demos = await deps.demoControl.listDemos()
    for (const [id, entry] of Object.entries(demos)) {
      try {
        const outcome = await deps.demoControl.stopDemo(id)
        receipt.demoOutcomes.push({ id, sandboxId: entry.sandboxId, status: outcome === 'already-stopped' ? 'already-stopped' : 'stopped', sessionId: entry.sessionId })
      } catch (error) {
        receipt.demoOutcomes.push({ id, sandboxId: entry.sandboxId, status: 'failed', sessionId: entry.sessionId, error: safeMessage(error) })
      }
    }

    const nonEpicBeads = beads.filter((issue) => issue.id !== `factory-${deps.epicKey}`)
    const closeReason = `[${deps.featureName}] shipped in PR #${verifiedPr.number} (${mergeCommitSha})`
    for (const bead of nonEpicBeads) {
      const workerSessionId = typeof bead.assignee === 'string' ? bead.assignee : undefined
      if (bead.status === 'closed') {
        receipt.alreadyClosedBeadIds.push(bead.id)
        receipt.beadOutcomes.push({ id: bead.id, status: 'already-closed', assignee: bead.assignee ?? null, workerSessionId })
        continue
      }
      try {
        await closeBead(deps.workspaceRoot, bead.id, closeReason)
        receipt.closedBeadIds.push(bead.id)
        receipt.beadOutcomes.push({ id: bead.id, status: 'closed', reason: closeReason, assignee: bead.assignee ?? null, workerSessionId })
      } catch (error) {
        receipt.beadOutcomes.push({ id: bead.id, status: 'failed', reason: closeReason, assignee: bead.assignee ?? null, workerSessionId, error: safeMessage(error) })
      }
    }

    const demoFailure = receipt.demoOutcomes.some((outcome) => outcome.status === 'failed')
    const beadFailure = receipt.beadOutcomes.some((outcome) => outcome.status === 'failed')
    const epicBead = epicBeads[0]!
    if (demoFailure || beadFailure) {
      receipt.overall = 'partial'
      receipt.code = 'PRECONDITION_FAILED'
      receipt.message = 'close_epic stopped before epic close because a required earlier phase failed'
      receipt.epicBead = { id: epicBead.id, status: epicBead.status === 'closed' ? 'already-closed' : 'failed', error: 'blocked by failed demo stop or child Bead close' }
      receipt.supervision = { status: 'failed', error: 'blocked by failed demo stop or child Bead close' }
      return textResult(receipt as unknown as Record<string, unknown>, false)
    }

    if (!cleanupRequested) {
      receipt.cleanup.snapshotRegistry = { status: 'skipped' }
      receipt.cleanup.branchDeletion = { status: 'skipped', branch, headRefOid: verifiedPr.headRefOid, reason: 'cleanup disabled' }
    } else {
      const invalidateAll = deps.invalidateAllSnapshotsForEpic ?? invalidateAllEpicSnapshots
      try {
        const stateRoot = `${deps.workspaceRoot}/apps/factory-playground/.factory-state`
        const invalidated = await invalidateAll(stateRoot, deps.epicKey)
        receipt.cleanup.snapshotRegistry = { status: 'invalidated', removedKeys: invalidated.removedKeys }
      } catch (error) {
        receipt.cleanup.snapshotRegistry = { status: 'failed', error: safeMessage(error) }
      }

      const defaultBranch = await readDefaultBranch(deps.workspaceRoot)
      const protectedReason = (
        branch === 'main' ? 'main branch is protected'
          : defaultBranch && branch === defaultBranch ? 'default branch is protected'
            : branch === deps.epicKey ? 'current app branch is protected'
              : null
      )
      if (protectedReason) {
        receipt.cleanup.branchDeletion = { status: 'skipped', branch, headRefOid: verifiedPr.headRefOid, reason: protectedReason }
      } else {
        try {
          const exists = await remoteBranchExists(deps.workspaceRoot, branch)
          if (!exists) {
            receipt.cleanup.branchDeletion = { status: 'already-absent', branch, headRefOid: verifiedPr.headRefOid, remote: 'origin' }
          } else {
            await execFileAsync('git', ['push', `--force-with-lease=refs/heads/${branch}:${verifiedPr.headRefOid}`, 'origin', '--delete', branch], { cwd: deps.workspaceRoot, maxBuffer: 16 * 1024 * 1024 })
            receipt.cleanup.branchDeletion = { status: 'deleted', branch, headRefOid: verifiedPr.headRefOid, remote: 'origin' }
          }
        } catch (error) {
          receipt.cleanup.branchDeletion = { status: 'failed', branch, headRefOid: verifiedPr.headRefOid, remote: 'origin', error: safeMessage(error) }
        }
      }
    }

    if (cleanupRequested && receipt.cleanup.snapshotRegistry?.status === 'failed' && receipt.cleanup.branchDeletion === undefined) {
      receipt.cleanup.branchDeletion = { status: 'skipped', branch, headRefOid: verifiedPr.headRefOid, reason: branch === deps.epicKey ? 'current app branch is protected' : 'cleanup blocked after snapshot failure' }
    }

    const cleanupFailure = receipt.cleanup.snapshotRegistry?.status === 'failed' || receipt.cleanup.branchDeletion?.status === 'failed'
    if (cleanupFailure) {
      receipt.overall = 'partial'
      receipt.code = 'CLEANUP_FAILED'
      receipt.message = 'close_epic stopped before epic close because cleanup failed'
      receipt.epicBead = { id: epicBead.id, status: epicBead.status === 'closed' ? 'already-closed' : 'failed', error: 'blocked by failed cleanup' }
      receipt.supervision = { status: 'failed', error: 'blocked by failed cleanup' }
      return textResult(receipt as unknown as Record<string, unknown>, false)
    }

    if (epicBead.status === 'closed') {
      receipt.alreadyClosedBeadIds.push(epicBead.id)
      receipt.epicBead = { id: epicBead.id, status: 'already-closed', assignee: epicBead.assignee ?? null }
    } else {
      await closeBead(deps.workspaceRoot, epicBead.id, closeReason)
      receipt.closedBeadIds.push(epicBead.id)
      receipt.epicBead = { id: epicBead.id, status: 'closed', reason: closeReason, assignee: epicBead.assignee ?? null }
    }

    try {
      await deps.supervisionControl.stopSupervision(callingSessionId, app, deps.workspaceScopeId)
      receipt.supervision = { status: 'stopped' }
    } catch (error) {
      receipt.overall = 'partial'
      receipt.code = 'SUPERVISION_STOP_FAILED'
      receipt.message = 'epic closed, but stopSupervision failed'
      receipt.supervision = { status: 'failed', error: safeMessage(error) }
    }

    return textResult(receipt as unknown as Record<string, unknown>, false)
  } catch (error) {
    return textResult({ code: 'CLOSE_EPIC_FAILED', message: safeMessage(error), callingSessionId }, true)
  }
}

export function formatFactoryStatusPr(prDetails: FactoryStatusPrDetails): FactoryStatusPrDetails {
  return prDetails
}
