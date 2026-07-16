import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, readlink, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

import { isPiSessionTranscriptReadable } from '@hachej/boring-agent/server/pi-session-readability'
import { createAgentAssetDigest, type Sha256Digest } from '@hachej/boring-agent/shared'
import type postgres from 'postgres'

import type { AgentHostActiveCollectionReader, AgentHostImmutableRevisionReader } from './activeCollectionReader.js'
import { captureAgentHostCoreProofRevision, createAgentHostCoreProofBindingIdDigest, createAgentHostCoreProofOperationIdDigest } from './agentHostCoreProof.js'
import { agentHostDigest, AgentHostError, AgentHostErrorCode, strictAgentHostId, strictAgentHostRef } from './agentHostPlan.js'

const MAX_ENTRIES = 200_000
const MAX_BYTES = 64 * 1024 * 1024 * 1024
const MAX_JSONL_FILES = 50_000
const MAX_JSONL_PATH_CHARS = 16 * 1024 * 1024
const MAX_HISTORY_ROWS = 200_000
const MAX_HISTORY_JSON_CHARS = 64 * 1024 * 1024
const REVISION = /^r\d{10}$/
const STAGING_REVISION = /^\.r\d{10}\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SESSION_ID = /^[A-Za-z0-9_-]+$/
const PI_ENTRY_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/
const MAX_JSONL_LINE_CHARS = 4 * 1024 * 1024
const MAX_SESSION_JSON_CHARS = 16 * 1024 * 1024

export interface AgentHostDrRowsV1 {
  readonly admissions: readonly unknown[]
  readonly journal: readonly unknown[]
  readonly membership: readonly unknown[]
}
export interface AgentHostDrFingerprintV1 {
  readonly hostIdentityDigest: Sha256Digest
  readonly admissionHistoryDigest: Sha256Digest
  readonly admissionRows: number
  readonly admittedBindingDigests: readonly Sha256Digest[]
  readonly journalHistoryDigest: Sha256Digest
  readonly journalRows: number
  readonly membershipDigest: Sha256Digest
  readonly membershipRows: number
  readonly revisionHistoryDigest: Sha256Digest
  readonly revisionRows: number
  readonly completeRevisions: readonly Readonly<{ revisionId: string; desiredStateDigest: Sha256Digest }>[]
  readonly destructivePublications: readonly Readonly<{
    operationIdDigest: Sha256Digest
    state: 'committed'
    expectedRevisionId: string
    expectedDesiredStateDigest: Sha256Digest
    requestedTargetRevisionId: string | null
    requestedTargetDesiredStateDigest: Sha256Digest | null
    publicationRevisionId: string
    publicationDesiredStateDigest: Sha256Digest
    removalBindingDigests: readonly Sha256Digest[]
  }>[]
  readonly activeDesiredStateDigest: Sha256Digest
  readonly stateRootDigest: Sha256Digest
  readonly workspaceRootDigest: Sha256Digest
  readonly workspaceDataDigest: Sha256Digest
  readonly sessionRootDigest: Sha256Digest
  readonly sessionHistoryDigest: Sha256Digest
}
export interface AgentHostDrCaptureV1 {
  readonly identity: AgentHostDrFingerprintV1
  readonly readableSessions: number
}

function failed(): never {
  throw new AgentHostError(AgentHostErrorCode.PROOF_INVALID, { field: 'proof' })
}
function canonical(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') { if (!Number.isFinite(value)) failed(); return value }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) { if (!Number.isFinite(value.getTime())) failed(); return value.toISOString() }
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value !== 'object') failed()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) failed()
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]))
}
async function fingerprint(domain: string, value: unknown): Promise<Sha256Digest> {
  return createAgentAssetDigest(JSON.stringify({ schemaVersion: 1, domain, value: canonical(value) }))
}
async function fileDigest(file: string): Promise<Sha256Digest> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  const hash = createHash('sha256')
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk as Uint8Array)
    return `sha256:${hash.digest('hex')}` as Sha256Digest
  } finally { await handle.close() }
}
interface TreeResult { readonly digest: Sha256Digest; readonly jsonl: readonly string[] }
async function treeFingerprint(root: string, domain: string): Promise<TreeResult> {
  if (!isAbsolute(root) || resolve(root) !== root) failed()
  const rootInfo = await lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) failed()
  const entries: unknown[] = []; const jsonl: string[] = []; let bytes = 0; let entryCount = 0; let jsonlPathChars = 0
  const walk = async (directory: string, relative: string): Promise<void> => {
    const pending = []
    for await (const entry of await opendir(directory)) {
      if (pending.length >= MAX_ENTRIES - entryCount) failed()
      pending.push(entry.name)
    }
    pending.sort()
    for (const name of pending) {
      const file = join(directory, name); const rel = relative ? `${relative}/${name}` : name
      const info = await lstat(file); const pathDigest = await fingerprint(`${domain}:path`, rel)
      if (++entryCount > MAX_ENTRIES) failed()
      if (info.isDirectory()) {
        entries.push({ kind: 'directory', pathDigest, mode: info.mode & 0o7777 }); await walk(file, rel)
      } else if (info.isFile()) {
        bytes += info.size; if (bytes > MAX_BYTES) failed()
        entries.push({ kind: 'file', pathDigest, mode: info.mode & 0o7777, bytes: info.size, contentDigest: await fileDigest(file) })
        if (name.endsWith('.jsonl')) {
          jsonlPathChars += file.length
          if (jsonl.length >= MAX_JSONL_FILES || jsonlPathChars > MAX_JSONL_PATH_CHARS) failed()
          jsonl.push(file)
        }
      } else if (info.isSymbolicLink()) {
        entries.push({ kind: 'link', pathDigest, mode: info.mode & 0o7777, targetDigest: await fingerprint(`${domain}:link`, await readlink(file)) })
      } else failed()
    }
  }
  await walk(root, '')
  return Object.freeze({ digest: await fingerprint(domain, entries), jsonl: Object.freeze(jsonl) })
}
interface ParsedJsonl {
  readonly file: string
  readonly headerId: string
  readonly headerVersion: number
  readonly message: boolean
  readonly linkedPath: string | null
  readonly entries?: readonly Record<string, unknown>[]
}
async function parseJsonl(file: string, collectEntries = false): Promise<ParsedJsonl | null> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true }); let pending = ''; let headerId: string | null = null; let headerVersion = 1; let message = false; let linkedPath: string | null = null; let entryIndex = 0; let jsonChars = 0
    const entries: Record<string, unknown>[] = []
    const line = (raw: string): boolean => {
      if (!raw.trim()) return true
      if (raw.length > MAX_JSONL_LINE_CHARS) return false
      jsonChars += raw.length
      if (jsonChars > MAX_SESSION_JSON_CHARS) return false
      let value: unknown
      try { value = JSON.parse(raw) } catch { return false }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
      const entry = value as Record<string, unknown>
      if (entry.type === 'session') {
        if (entryIndex !== 0 || headerId !== null || typeof entry.id !== 'string' || entry.id.length > 250 || !PI_ENTRY_ID.test(entry.id)
          || (entry.version !== undefined && (typeof entry.version !== 'number' || !Number.isSafeInteger(entry.version) || entry.version < 1))
          || (entry.cwd !== undefined && (typeof entry.cwd !== 'string' || entry.cwd.includes('\0')))
          || typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp))) return false
        headerId = entry.id
        headerVersion = typeof entry.version === 'number' ? entry.version : 1
      } else {
        if (headerId === null) return false
        if (entry.type === 'pi_session_file') {
          if (linkedPath !== null || typeof entry.path !== 'string' || entry.path.length === 0 || entry.path.length > 4096 || entry.path.includes('\0')
            || typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp))) return false
          linkedPath = entry.path
          if (collectEntries) entries.push(entry)
          entryIndex++
          return true
        }
      }
      if (entry.type === 'message') {
        const body = entry.message
        if (typeof body !== 'object' || body === null || Array.isArray(body)
          || typeof (body as Record<string, unknown>).role !== 'string'
          || !Object.hasOwn(body, 'content')) return false
        message = true
      }
      if (collectEntries) entries.push(entry)
      entryIndex++
      return true
    }
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      pending += decoder.decode(chunk as Uint8Array, { stream: true })
      const lines = pending.split('\n'); pending = lines.pop() ?? ''
      if (lines.some((value) => !line(value))) return null
      if (pending.length > MAX_JSONL_LINE_CHARS) return null
    }
    pending += decoder.decode()
    if (pending && !line(pending)) return null
    const name = basename(file, '.jsonl')
    return headerId !== null && (name === headerId || name.endsWith(`_${headerId}`))
      ? { file, headerId, headerVersion, message, linkedPath, ...(collectEntries ? { entries: Object.freeze(entries) } : {}) } : null
  } finally { await handle.close() }
}
async function productionReadable(session: ParsedJsonl): Promise<boolean> {
  const collected = await parseJsonl(session.file, true)
  if (!collected || collected.headerId !== session.headerId || collected.headerVersion !== session.headerVersion || !collected.entries) return false
  return await isPiSessionTranscriptReadable({
    filePath: session.file,
    sessionDir: dirname(session.file),
    runtimeCwd: '/',
    expectedHeaderId: session.headerId,
    headerVersion: session.headerVersion,
    entries: collected.entries,
  })
}
async function readableSessionCount(files: readonly string[], sessionRoot: string): Promise<number> {
  const parsed: ParsedJsonl[] = []
  for (const file of files) { const value = await parseJsonl(file); if (value) parsed.push(value) }
  const byPath = new Map(parsed.map((value) => [resolve(value.file), value]))
  const byId = new Map<string, ParsedJsonl[]>()
  for (const value of parsed) { const entries = byId.get(value.headerId) ?? []; entries.push(value); byId.set(value.headerId, entries) }
  const referencedNativeNames = new Set(parsed.flatMap((value) => value.linkedPath ? [basename(value.linkedPath)] : []))
  let readable = 0
  for (const [id, entries] of byId) {
    const wrapper = entries.find((value) => basename(value.file, '.jsonl') === id)
    if (wrapper) {
      if (!wrapper.linkedPath) { if (wrapper.message && await productionReadable(wrapper)) readable++; continue }
      if (!isAbsolute(wrapper.linkedPath)) continue
      const linked = resolve(wrapper.linkedPath)
      if (linked !== sessionRoot && !linked.startsWith(`${sessionRoot}${sep}`)) continue
      const transcript = byPath.get(linked)
      if (transcript?.message && await productionReadable(transcript)) readable++
    } else {
      for (const value of entries) {
        if (value.message && !referencedNativeNames.has(basename(value.file))
          && basename(value.file, '.jsonl').endsWith(`_${id}`) && await productionReadable(value)) { readable++; break }
      }
    }
  }
  return readable
}
async function completeRevisionHistory(hostRoot: string, reader: Pick<AgentHostImmutableRevisionReader, 'readComplete'>) {
  const revisionIds: string[] = []
  for await (const entry of await opendir(join(hostRoot, 'revisions'))) {
    if (entry.isDirectory() && REVISION.test(entry.name)) revisionIds.push(entry.name)
    else if (!entry.isDirectory() || !STAGING_REVISION.test(entry.name)) failed()
  }
  revisionIds.sort()
  const completeRevisions = []
  for (const revisionId of revisionIds) {
    const complete = await reader.readComplete(revisionId)
    if (!complete || complete.revisionId !== revisionId || complete.completion.status !== 'COMPLETE'
      || complete.completion.revisionId !== revisionId || complete.completion.desiredStateDigest !== complete.desiredStateDigest) failed()
    completeRevisions.push(Object.freeze({ revisionId, desiredStateDigest: complete.desiredStateDigest }))
  }
  return Object.freeze(completeRevisions)
}
async function destructivePublications(rows: readonly unknown[]): Promise<AgentHostDrFingerprintV1['destructivePublications']> {
  const pending = new Map<string, Record<string, unknown>>()
  const terminal = new Set<string>()
  const committed = []
  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) failed()
    const row = raw as Record<string, unknown>
    const keys = ['sequence', 'operation_id', 'state', 'expected_revision', 'expected_digest', 'source_revision', 'source_digest', 'target_revision', 'target_digest', 'removal_binding_ids', 'recorded_at']
    if (Object.keys(row).length !== keys.length || Object.keys(row).some((key) => !keys.includes(key))) failed()
    const operationId = strictAgentHostRef(row.operation_id, 'operationId')
    const state = row.state
    if (state !== 'prepared' && state !== 'committed' && state !== 'aborted') failed()
    let sequence: bigint
    try { sequence = BigInt(row.sequence as string | number | bigint) } catch { failed() }
    if (sequence <= 0n || !(row.recorded_at instanceof Date) || !Number.isFinite(row.recorded_at.getTime())
      || typeof row.expected_revision !== 'string' || !REVISION.test(row.expected_revision)
      || (row.source_revision === null) !== (row.source_digest === null)
      || row.source_revision !== null && (typeof row.source_revision !== 'string' || !REVISION.test(row.source_revision))
      || typeof row.target_revision !== 'string' || !REVISION.test(row.target_revision)
      || !Array.isArray(row.removal_binding_ids) || row.removal_binding_ids.length === 0) failed()
    const removalBindingIds = row.removal_binding_ids.map((value) => strictAgentHostRef(value, 'removalBindingIds'))
    if (new Set(removalBindingIds).size !== removalBindingIds.length
      || removalBindingIds.some((value, index) => index > 0 && removalBindingIds[index - 1]! >= value)) failed()
    const identity = {
      expectedRevisionId: row.expected_revision,
      expectedDesiredStateDigest: agentHostDigest(row.expected_digest, 'expectedDigest'),
      requestedTargetRevisionId: row.source_revision,
      requestedTargetDesiredStateDigest: row.source_digest === null ? null : agentHostDigest(row.source_digest, 'sourceDigest'),
      publicationRevisionId: row.target_revision,
      publicationDesiredStateDigest: agentHostDigest(row.target_digest, 'targetDigest'),
      removalBindingIds,
    }
    if (state === 'prepared') {
      if (pending.has(operationId) || terminal.has(operationId)) failed()
      pending.set(operationId, identity)
      continue
    }
    const prepared = pending.get(operationId)
    if (!prepared || terminal.has(operationId) || JSON.stringify(prepared) !== JSON.stringify(identity)) failed()
    terminal.add(operationId)
    if (state === 'committed') committed.push(Object.freeze({
      operationIdDigest: await createAgentHostCoreProofOperationIdDigest(operationId), state,
      expectedRevisionId: identity.expectedRevisionId, expectedDesiredStateDigest: identity.expectedDesiredStateDigest,
      requestedTargetRevisionId: identity.requestedTargetRevisionId, requestedTargetDesiredStateDigest: identity.requestedTargetDesiredStateDigest,
      publicationRevisionId: identity.publicationRevisionId, publicationDesiredStateDigest: identity.publicationDesiredStateDigest,
      removalBindingDigests: Object.freeze((await Promise.all(removalBindingIds.map(createAgentHostCoreProofBindingIdDigest))).sort()),
    }))
  }
  if (pending.size !== terminal.size) failed()
  committed.sort((left, right) => left.operationIdDigest < right.operationIdDigest ? -1 : left.operationIdDigest > right.operationIdDigest ? 1 : 0)
  return Object.freeze(committed)
}

export function createAgentHostDrRowsReader(sql: postgres.Sql): (hostId: string, workspaceIds: readonly string[]) => Promise<AgentHostDrRowsV1> {
  return async (hostId, workspaceIds) => {
    try {
      return await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (transaction) => {
        let boundedBytes = 0n
        const bound = async (query: PromiseLike<readonly Record<string, unknown>[]>) => {
          const [value] = await query
          let rows: bigint; let bytes: bigint
          try { rows = BigInt(value?.rows as string); bytes = BigInt(value?.bytes as string) } catch { failed() }
          if (rows < 0n || rows > BigInt(MAX_HISTORY_ROWS) || bytes < 0n) failed()
          boundedBytes += bytes
          if (boundedBytes > BigInt(MAX_HISTORY_JSON_CHARS)) failed()
        }
        await bound(transaction`SELECT count(*)::text AS rows, coalesce(sum(pg_column_size(a)), 0)::text AS bytes
          FROM agent_host_binding_admissions a WHERE host_id = ${hostId}`)
        await bound(transaction`SELECT count(*)::text AS rows, coalesce(sum(pg_column_size(j)), 0)::text AS bytes
          FROM agent_host_destructive_publication_events j WHERE host_id = ${hostId}`)
        await bound(transaction`SELECT count(*)::text AS rows, coalesce(sum(pg_column_size(wm) + pg_column_size(w)), 0)::text AS bytes
          FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
          WHERE wm.workspace_id::text = ANY(${workspaceIds}::text[])`)
        let rows = 0; let chars = 0
        const collect = async (query: { cursor(rows?: number): AsyncIterable<readonly Record<string, unknown>[]> }) => {
          const values: unknown[] = []
          for await (const batch of query.cursor(128)) for (const row of batch) {
            if (++rows > MAX_HISTORY_ROWS * 3) failed()
            chars += JSON.stringify(canonical(row)).length
            if (chars > MAX_HISTORY_JSON_CHARS) failed()
            values.push(row)
          }
          return Object.freeze(values)
        }
        const admissions = await collect(transaction`SELECT sequence::text, binding_id, execution_identity_digest, active_revision,
          first_desired_state_digest, admitted_at FROM agent_host_binding_admissions WHERE host_id = ${hostId} ORDER BY sequence`)
        const journal = await collect(transaction`SELECT sequence::text, operation_id, state, expected_revision, expected_digest,
          source_revision, source_digest, target_revision, target_digest, removal_binding_ids, recorded_at FROM agent_host_destructive_publication_events
          WHERE host_id = ${hostId} ORDER BY sequence`)
        const membership = await collect(transaction`SELECT wm.workspace_id::text, wm.user_id::text, wm.role, wm.created_at,
          w.created_by::text, w.managed_by, w.deleted_at FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
          WHERE wm.workspace_id::text = ANY(${workspaceIds}::text[]) ORDER BY wm.workspace_id, wm.user_id`)
        return Object.freeze({ admissions, journal, membership })
      })
    } catch { failed() }
  }
}
function assertBoundedRows(rows: AgentHostDrRowsV1): void {
  let chars = 0
  for (const values of [rows.admissions, rows.journal, rows.membership]) {
    if (values.length > MAX_HISTORY_ROWS) failed()
    for (const row of values) {
      chars += JSON.stringify(canonical(row)).length
      if (chars > MAX_HISTORY_JSON_CHARS) failed()
    }
  }
}

export async function captureAgentHostDrFingerprint(options: {
  readonly reader: AgentHostActiveCollectionReader
  readonly revisionReader: Pick<AgentHostImmutableRevisionReader, 'readComplete'>
  readonly hostId: string
  readonly hostRoot: string
  readonly workspaceRoot: string
  readonly sessionRoot: string
  readonly readRows: (hostId: string, workspaceIds: readonly string[]) => Promise<AgentHostDrRowsV1>
}): Promise<AgentHostDrCaptureV1> {
  try {
    const hostId = strictAgentHostId(options.hostId, 'hostId')
    for (const root of [options.hostRoot, options.workspaceRoot, options.sessionRoot]) {
      if (typeof root !== 'string' || root.includes('\0') || root.split(sep).includes('..')) failed()
    }
    const roots = await Promise.all([options.hostRoot, options.workspaceRoot, options.sessionRoot].map((root) => realpath(root)))
    for (const [index, root] of roots.entries()) for (const other of roots.slice(index + 1)) {
      if (root === other || root.startsWith(`${other}${sep}`) || other.startsWith(`${root}${sep}`)) failed()
    }
    const collection = await options.reader.read(); if (!collection) failed()
    const snapshot = await captureAgentHostCoreProofRevision(options.reader)
    const workspaceIds = collection.desired.plan.bindings.map((value) => value.workspaceId)
    const [rows, revisions, workspaces, sessions, completeRevisions] = await Promise.all([
      options.readRows(hostId, workspaceIds), treeFingerprint(options.hostRoot, 'boring-agent-host-dr-revisions:v1'),
      treeFingerprint(options.workspaceRoot, 'boring-agent-host-dr-workspaces:v1'), treeFingerprint(options.sessionRoot, 'boring-agent-host-dr-sessions:v1'),
      completeRevisionHistory(options.hostRoot, options.revisionReader),
    ])
    const readable = await readableSessionCount(sessions.jsonl, roots[2]!)
    assertBoundedRows(rows)
    const committedPublications = await destructivePublications(rows.journal)
    const admittedBindingDigests = await Promise.all(rows.admissions.map((row) => {
      if (typeof row !== 'object' || row === null || Array.isArray(row) || typeof (row as Record<string, unknown>).binding_id !== 'string') failed()
      return createAgentHostCoreProofBindingIdDigest((row as Record<string, string>).binding_id)
    }))
    admittedBindingDigests.sort()
    const identity = Object.freeze({
      hostIdentityDigest: await fingerprint('boring-agent-host-dr-host:v1', hostId),
      admissionHistoryDigest: await fingerprint('boring-agent-host-dr-admissions:v1', rows.admissions), admissionRows: rows.admissions.length,
      admittedBindingDigests: Object.freeze(admittedBindingDigests),
      journalHistoryDigest: await fingerprint('boring-agent-host-dr-journal:v1', rows.journal), journalRows: rows.journal.length,
      membershipDigest: await fingerprint('boring-agent-host-dr-membership:v1', rows.membership), membershipRows: rows.membership.length,
      revisionHistoryDigest: revisions.digest, revisionRows: completeRevisions.length, completeRevisions,
      destructivePublications: committedPublications,
      activeDesiredStateDigest: snapshot.desiredStateDigest,
      stateRootDigest: await fingerprint('boring-agent-host-dr-state-root:v1', options.hostRoot),
      workspaceRootDigest: await fingerprint('boring-agent-host-dr-workspace-root:v1', options.workspaceRoot), workspaceDataDigest: workspaces.digest,
      sessionRootDigest: await fingerprint('boring-agent-host-dr-session-root:v1', options.sessionRoot), sessionHistoryDigest: sessions.digest,
    })
    return Object.freeze({ identity, readableSessions: readable })
  } catch (error) {
    if (error instanceof AgentHostError && error.code === AgentHostErrorCode.PROOF_INVALID) throw error
    failed()
  }
}
