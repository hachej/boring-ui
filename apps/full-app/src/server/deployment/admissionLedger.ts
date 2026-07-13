import type postgres from 'postgres'
import { createAgentAssetDigest, OpaqueRefSchema, type Sha256Digest } from '@hachej/boring-agent/shared'
import type { D1ActiveCollectionReader } from './activeCollectionReader.js'
import { d1Digest, D1HostError, D1HostErrorCode, strictD1HostId, strictD1Ref } from './d1Plan.js'

const attestedBrand: unique symbol = Symbol('AttestedD1DatabaseConnection')
const liveConnections = new WeakMap<AttestedD1DatabaseConnection, LiveConnection>()
interface ReservedConnectionState { connectionId: number | null; lost: boolean }
const reservedConnectionStates = new WeakMap<postgres.ReservedSql, ReservedConnectionState>()
let nextReservationClaim = 0
const REVISION_RE = /^r\d{10}$/
interface LiveConnection {
  readonly databaseRef: string
  readonly sql: postgres.Sql
  readonly ownsClient: boolean
}
export interface AttestedD1DatabaseConnection {
  readonly [attestedBrand]: true
}
export interface D1AdmissionTarget {
  readonly hostId: string
  readonly bindingId: string
  readonly workspaceId: string
  readonly defaultDeploymentId: string
}
export interface D1BindingAdmission {
  readonly sequence: bigint
  readonly hostId: string
  readonly bindingId: string
  readonly executionIdentityDigest: Sha256Digest
  readonly firstRevisionId: string
  readonly firstDesiredStateDigest: Sha256Digest
  readonly admittedAt: Date
}
export interface D1AdmissionFenceKey {
  readonly hostId: string
  readonly bindingId: string
}
export interface D1AdmissionLedger {
  readonly databaseRef: string
  listBindingIds(hostId: string, databaseRef: string): Promise<readonly string[]>
  admit(activeReader: D1ActiveCollectionReader, target: D1AdmissionTarget): Promise<D1BindingAdmission>
  withBindingFences<T>(keys: readonly D1AdmissionFenceKey[], operation: (sql: postgres.ReservedSql) => Promise<T>): Promise<T>
  close(): Promise<void>
}
interface AdmissionRow {
  sequence: string | number | bigint
  hostId: string
  bindingId: string
  executionIdentityDigest: string | null
  firstRevisionId: string
  firstDesiredStateDigest: string | null
  admittedAt: Date
}

interface AdmissionIdentity {
  readonly executionIdentityDigest: Sha256Digest
  readonly firstRevisionId: string
  readonly firstDesiredStateDigest: Sha256Digest
}

function failed(): D1HostError {
  return new D1HostError(D1HostErrorCode.ADMISSION_RECORD_FAILED, { field: 'admission' })
}
function mismatch(): D1HostError {
  return new D1HostError(D1HostErrorCode.ADMISSION_IDENTITY_MISMATCH, { field: 'executionIdentityDigest' })
}
function preserveMismatch(error: unknown): never {
  if (error instanceof D1HostError && error.code === D1HostErrorCode.ADMISSION_IDENTITY_MISMATCH) throw error
  throw failed()
}
function connectionLost(error: unknown): boolean {
  const code = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined
  return code === 'CONNECTION_CLOSED' || code === 'CONNECTION_DESTROYED' || code === 'CONNECTION_ENDED' || code === 'ECONNRESET' || code === 'EPIPE'
}
async function bounded<T>(value: PromiseLike<T>): Promise<T | null> {
  const pending = Promise.resolve(value); let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([pending, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 5_000) })]) }
  finally { if (timer) clearTimeout(timer); void pending.catch(() => {}) }
}
function revision(value: unknown): string {
  if (typeof value !== 'string' || !REVISION_RE.test(value)) throw failed()
  return value
}
function opaque(value: unknown, field: string): string {
  const parsed = OpaqueRefSchema.safeParse(value)
  if (!parsed.success) throw failed()
  return parsed.data
}
function row(value: AdmissionRow | undefined): D1BindingAdmission {
  if (!value || typeof value.sequence === 'number' && !Number.isSafeInteger(value.sequence)
    || typeof value.admittedAt !== 'object' || !(value.admittedAt instanceof Date) || !Number.isFinite(value.admittedAt.getTime())) throw failed()
  let sequence: bigint
  try { sequence = BigInt(value.sequence) } catch { throw failed() }
  if (sequence <= 0n) throw failed()
  return Object.freeze({
    sequence,
    hostId: strictD1HostId(value.hostId, 'admission.hostId'),
    bindingId: strictD1Ref(value.bindingId, 'admission.bindingId'),
    executionIdentityDigest: d1Digest(value.executionIdentityDigest, 'admission.executionIdentityDigest'),
    firstRevisionId: revision(value.firstRevisionId),
    firstDesiredStateDigest: d1Digest(value.firstDesiredStateDigest, 'admission.firstDesiredStateDigest'),
    admittedAt: new Date(value.admittedAt),
  })
}

function take(connection: AttestedD1DatabaseConnection): LiveConnection {
  const live = liveConnections.get(connection)
  if (!live) throw failed()
  liveConnections.delete(connection)
  return live
}

export function isD1ReservedConnectionLost(sql: postgres.ReservedSql): boolean {
  return reservedConnectionStates.get(sql)?.lost ?? false
}

/** D1-005c is the sole production caller after it proves this client. */
export function mintAttestedD1DatabaseConnection(
  databaseRef: string,
  sql: postgres.Sql,
  options: { readonly ownsClient?: boolean } = {},
): AttestedD1DatabaseConnection {
  const capability = Object.freeze({ [attestedBrand]: true as const })
  liveConnections.set(capability, { databaseRef: strictD1Ref(databaseRef, 'databaseRef'), sql, ownsClient: options.ownsClient !== false })
  return capability
}

export async function closeAttestedD1DatabaseConnection(connection: AttestedD1DatabaseConnection): Promise<void> {
  const live = liveConnections.get(connection)
  if (!live) return
  liveConnections.delete(connection)
  if (live.ownsClient) await live.sql.end()
}

async function insertOrRead(sql: postgres.ReservedSql, target: D1AdmissionTarget, identity: AdmissionIdentity): Promise<D1BindingAdmission> {
  let transaction = false
  try {
    if (isD1ReservedConnectionLost(sql)) throw failed()
    await sql`BEGIN`; transaction = true
    const [pendingRemoval] = await sql<{ pending: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM d1_destructive_publication_events AS prepared
        WHERE prepared.host_id = ${target.hostId}
          AND prepared.state = 'prepared'
          AND ${target.bindingId} = ANY(prepared.removal_binding_ids)
          AND NOT EXISTS (
            SELECT 1 FROM d1_destructive_publication_events AS terminal
            WHERE terminal.operation_id = prepared.operation_id
              AND terminal.state IN ('committed', 'aborted')
          )
      ) AS pending
    `
    if (!pendingRemoval || typeof pendingRemoval.pending !== 'boolean' || pendingRemoval.pending) throw failed()
    const inserted = await sql<AdmissionRow[]>`
      INSERT INTO d1_binding_admissions (
        host_id, binding_id, active_revision, execution_identity_digest, first_desired_state_digest
      ) VALUES (
        ${target.hostId}, ${target.bindingId}, ${identity.firstRevisionId},
        ${identity.executionIdentityDigest}, ${identity.firstDesiredStateDigest}
      )
      ON CONFLICT (host_id, binding_id) DO NOTHING
      RETURNING sequence, host_id AS "hostId", binding_id AS "bindingId",
        execution_identity_digest AS "executionIdentityDigest", active_revision AS "firstRevisionId",
        first_desired_state_digest AS "firstDesiredStateDigest", admitted_at AS "admittedAt"
    `
    const existing = inserted[0] ?? (await sql<AdmissionRow[]>`
      SELECT sequence, host_id AS "hostId", binding_id AS "bindingId",
        execution_identity_digest AS "executionIdentityDigest", active_revision AS "firstRevisionId",
        first_desired_state_digest AS "firstDesiredStateDigest", admitted_at AS "admittedAt"
      FROM d1_binding_admissions
      WHERE host_id = ${target.hostId} AND binding_id = ${target.bindingId}
    `)[0]
    if (existing?.executionIdentityDigest === null || existing?.firstDesiredStateDigest === null) throw mismatch()
    const admission = row(existing)
    if (admission.executionIdentityDigest !== identity.executionIdentityDigest) throw mismatch()
    await sql`COMMIT`; transaction = false
    return admission
  } catch (error) {
    if (transaction) try { await bounded(sql`ROLLBACK`) } catch {}
    preserveMismatch(error)
  }
}

async function admissionIdentity(
  active: NonNullable<Awaited<ReturnType<D1ActiveCollectionReader['read']>>>,
  bindingId: string,
): Promise<AdmissionIdentity> {
  const binding = active.desired.plan.bindings.find((entry) => entry.bindingId === bindingId)
  const resolved = active.desired.resolvedBindings.find((entry) => entry.bindingId === bindingId)
  const observed = active.observation.bindings.find((entry) => entry.bindingId === bindingId)
  if (!binding || !resolved || !observed) throw failed()
  const { hostname: _hostname, landing: _landing, ...executionBinding } = binding
  const executionIdentityDigest = await createAgentAssetDigest(JSON.stringify({
    schemaVersion: 1,
    domain: 'boring-d1-admission-execution:v1',
    binding: executionBinding,
    resolved,
    runtimeInputs: observed.runtimeInputs,
  }))
  return Object.freeze({
    executionIdentityDigest,
    firstRevisionId: revision(active.active.revisionId),
    firstDesiredStateDigest: d1Digest(active.active.desiredStateDigest, 'active.desiredStateDigest'),
  })
}

export function createD1AdmissionLedger(
  connection: AttestedD1DatabaseConnection,
): D1AdmissionLedger {
  const live = take(connection)
  let closed = false; let closing = false
  const claims = new Map<string, ReservedConnectionState>(); const reservations = new Map<number, Set<ReservedConnectionState>>()
  const previousOnClose = live.sql.options.onclose; const previousDebug = live.sql.options.debug
  const debug = (connectionId: number, query: string, parameters: unknown[], types: unknown[]) => {
    if (typeof previousDebug === 'function') previousDebug(connectionId, query, parameters, types); const state = parameters.map(String).map((value) => claims.get(value)).find(Boolean)
    if (state) { state.connectionId = connectionId; const active = reservations.get(connectionId) ?? new Set(); active.add(state); reservations.set(connectionId, active) }
  }
  const onclose = (connectionId: number) => {
    try { if (typeof previousOnClose === 'function') previousOnClose(connectionId) } finally {
      if (!closing) for (const state of reservations.get(connectionId) ?? []) state.lost = true; reservations.delete(connectionId)
    }
  }
  live.sql.options.debug = debug; live.sql.options.onclose = onclose
  const restoreHooks = () => {
    if (live.sql.options.debug === debug) live.sql.options.debug = previousDebug; if (live.sql.options.onclose === onclose) live.sql.options.onclose = previousOnClose
  }
  const available = () => { if (closed) throw failed() }
  const abandon = async () => {
    closed = true; closing = true; restoreHooks(); await live.sql.end({ timeout: 0 }).catch(() => {})
  }
  const claim = async (sql: postgres.ReservedSql) => {
    const state: ReservedConnectionState = { connectionId: null, lost: false }; const token = `boring-d1-reservation:${++nextReservationClaim}`
    reservedConnectionStates.set(sql, state); claims.set(token, state); try { const [row] = await sql<{ token: string }[]>`SELECT ${token}::text AS token`; if (row?.token !== token || state.connectionId === null) throw failed() } finally { claims.delete(token) }
  }
  const releaseState = (sql: postgres.ReservedSql) => {
    const state = reservedConnectionStates.get(sql); if (state?.connectionId === null || state?.connectionId === undefined) return; const active = reservations.get(state.connectionId); active?.delete(state); if (active?.size === 0) reservations.delete(state.connectionId)
  }
  const key = (raw: D1AdmissionFenceKey): D1AdmissionFenceKey => Object.freeze({
    hostId: strictD1HostId(raw.hostId, 'hostId'), bindingId: strictD1Ref(raw.bindingId, 'bindingId'),
  })
  const lockName = (value: D1AdmissionFenceKey) => `boring-d1-admission:v1:${value.hostId.length}:${value.hostId}:${value.bindingId.length}:${value.bindingId}`

  const withBindingFences = async <T>(rawKeys: readonly D1AdmissionFenceKey[], operation: (sql: postgres.ReservedSql) => Promise<T>): Promise<T> => {
    available()
    const keys = rawKeys.map(key).sort((left, right) => lockName(left) < lockName(right) ? -1 : lockName(left) > lockName(right) ? 1 : 0)
    if (keys.length === 0 || new Set(keys.map(lockName)).size !== keys.length) throw failed()
    const sql = await live.sql.reserve().catch(() => { throw failed() })
    const locked: string[] = []; let result: T | undefined; let complete = false; let operationStarted = false; let unsafe = false; let error: unknown
    try {
      await claim(sql)
      for (const name of keys.map(lockName)) {
        if (isD1ReservedConnectionLost(sql)) throw failed()
        await sql`SELECT pg_advisory_lock(hashtextextended(${name}, 0::bigint))`; locked.push(name)
      }
      operationStarted = true; result = await operation(sql); complete = true
    } catch (caught) { unsafe = isD1ReservedConnectionLost(sql) || connectionLost(caught); error = operationStarted ? caught : failed() }
    finally {
      let connectionUnsafe = isD1ReservedConnectionLost(sql) || unsafe || connectionLost(error)
      for (const name of locked.reverse()) try {
        if (connectionUnsafe) break
        const unlocked = await bounded(sql<{ unlocked: boolean }[]>`SELECT pg_advisory_unlock(hashtextextended(${name}, 0::bigint)) AS unlocked`)
        if (!unlocked) { connectionUnsafe = true; break }
        const [unlock] = unlocked
        if (unlock?.unlocked !== true) { connectionUnsafe = true; error ??= failed() }
      } catch { connectionUnsafe = true; error ??= failed() }
      if (!connectionUnsafe) try { releaseState(sql); sql.release() } catch { connectionUnsafe = true; error ??= failed() }
      if (connectionUnsafe) { await abandon(); error = failed() }
    }
    if (error || !complete) throw error ?? failed()
    return result as T
  }

  const listBindingIds = async (hostId: string, databaseRef: string): Promise<readonly string[]> => {
    available()
    const expectedHost = strictD1HostId(hostId, 'hostId')
    if (strictD1Ref(databaseRef, 'databaseRef') !== live.databaseRef) throw failed()
    const sql = await live.sql.reserve().catch(() => { throw failed() })
    try {
      await claim(sql)
      const rows = await sql<{ bindingId: string }[]>`
        SELECT binding_id AS "bindingId" FROM d1_binding_admissions
        WHERE host_id = ${expectedHost} ORDER BY binding_id
      `
      return Object.freeze(rows.map((entry) => strictD1Ref(entry.bindingId, 'admission.bindingId')))
    } catch (caught) { if (isD1ReservedConnectionLost(sql) || connectionLost(caught)) await abandon(); throw failed() } finally { if (!closed) try { releaseState(sql); sql.release() } catch { await abandon(); throw failed() } }
  }

  const admit = async (activeReader: D1ActiveCollectionReader, rawTarget: D1AdmissionTarget): Promise<D1BindingAdmission> => {
    try {
      const target = Object.freeze({
        ...key(rawTarget), workspaceId: opaque(rawTarget.workspaceId, 'workspaceId'),
        defaultDeploymentId: opaque(rawTarget.defaultDeploymentId, 'defaultDeploymentId'),
      })
      return await withBindingFences([target], async (sql) => {
        const active = await activeReader.read()
        const binding = active?.desired.plan.bindings.find((entry) => entry.bindingId === target.bindingId)
        const resolved = active?.desired.resolvedBindings.find((entry) => entry.bindingId === target.bindingId)
        if (!active || active.desired.plan.hostId !== target.hostId || active.desired.plan.databaseRef !== live.databaseRef
          || binding?.workspaceId !== target.workspaceId || binding.defaultDeploymentId !== target.defaultDeploymentId
          || resolved?.workspace.workspaceId !== target.workspaceId || resolved.workspace.defaultDeploymentId !== target.defaultDeploymentId) throw failed()
        return insertOrRead(sql, target, await admissionIdentity(active, target.bindingId))
      })
    } catch (error) { preserveMismatch(error) }
  }

  return Object.freeze({
    databaseRef: live.databaseRef, listBindingIds, admit, withBindingFences,
    async close() {
      if (closed) return
      closed = true; closing = true; restoreHooks()
      if (live.ownsClient) await live.sql.end()
    },
  })
}
