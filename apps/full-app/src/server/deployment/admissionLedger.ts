import type postgres from 'postgres'
import { OpaqueRefSchema } from '@hachej/boring-agent/shared'
import type { D1ActiveCollectionReader } from './activeCollectionReader.js'
import { D1HostError, D1HostErrorCode, strictD1HostId, strictD1Ref } from './d1Plan.js'

const attestedBrand: unique symbol = Symbol('AttestedD1DatabaseConnection')
const liveConnections = new WeakMap<AttestedD1DatabaseConnection, LiveConnection>()
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
  readonly activeRevision: string
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
  activeRevision: string
  admittedAt: Date
}

function failed(): D1HostError {
  return new D1HostError(D1HostErrorCode.ADMISSION_RECORD_FAILED, { field: 'admission' })
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
    activeRevision: revision(value.activeRevision),
    admittedAt: new Date(value.admittedAt),
  })
}

function take(connection: AttestedD1DatabaseConnection): LiveConnection {
  const live = liveConnections.get(connection)
  if (!live) throw failed()
  liveConnections.delete(connection)
  return live
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

async function insertOrRead(sql: postgres.ReservedSql, target: D1AdmissionTarget, activeRevision: string): Promise<D1BindingAdmission> {
  let transaction = false
  try {
    await sql`BEGIN`; transaction = true
    const inserted = await sql<AdmissionRow[]>`
      INSERT INTO d1_binding_admissions (host_id, binding_id, active_revision)
      VALUES (${target.hostId}, ${target.bindingId}, ${activeRevision})
      ON CONFLICT (host_id, binding_id) DO NOTHING
      RETURNING sequence, host_id AS "hostId", binding_id AS "bindingId",
        active_revision AS "activeRevision", admitted_at AS "admittedAt"
    `
    const existing = inserted[0] ?? (await sql<AdmissionRow[]>`
      SELECT sequence, host_id AS "hostId", binding_id AS "bindingId",
        active_revision AS "activeRevision", admitted_at AS "admittedAt"
      FROM d1_binding_admissions
      WHERE host_id = ${target.hostId} AND binding_id = ${target.bindingId}
    `)[0]
    const admission = row(existing)
    await sql`COMMIT`; transaction = false
    return admission
  } catch {
    if (transaction) try { await bounded(sql`ROLLBACK`) } catch {}
    throw failed()
  }
}

export function createD1AdmissionLedger(
  connection: AttestedD1DatabaseConnection,
): D1AdmissionLedger {
  const live = take(connection)
  let closed = false
  const available = () => { if (closed) throw failed() }
  const abandon = async () => { closed = true; await live.sql.end({ timeout: 0 }).catch(() => {}) }
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
      for (const name of keys.map(lockName)) {
        await sql`SELECT pg_advisory_lock(hashtextextended(${name}, 0::bigint))`; locked.push(name)
      }
      operationStarted = true; result = await operation(sql); complete = true
    } catch (caught) { unsafe = connectionLost(caught); error = operationStarted ? caught : failed() }
    finally {
      let lost = unsafe || connectionLost(error)
      for (const name of locked.reverse()) try {
        if (lost) break
        const unlocked = await bounded(sql<{ unlocked: boolean }[]>`SELECT pg_advisory_unlock(hashtextextended(${name}, 0::bigint)) AS unlocked`)
        if (!unlocked) { lost = true; break }
        const [unlock] = unlocked
        if (unlock?.unlocked !== true) { lost = true; error ??= failed() }
      } catch { lost = true; error ??= failed() }
      if (!lost) try { sql.release() } catch { lost = true; error ??= failed() }
      if (lost) { await abandon(); error = failed() }
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
      const rows = await sql<{ bindingId: string }[]>`
        SELECT binding_id AS "bindingId" FROM d1_binding_admissions
        WHERE host_id = ${expectedHost} ORDER BY binding_id
      `
      return Object.freeze(rows.map((entry) => strictD1Ref(entry.bindingId, 'admission.bindingId')))
    } catch (caught) { if (connectionLost(caught)) await abandon(); throw failed() } finally { if (!closed) try { sql.release() } catch { await abandon(); throw failed() } }
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
        return insertOrRead(sql, target, revision(active.active.revisionId))
      })
    } catch { throw failed() }
  }

  return Object.freeze({
    databaseRef: live.databaseRef, listBindingIds, admit, withBindingFences,
    async close() { if (closed) return; closed = true; if (live.ownsClient) await live.sql.end() },
  })
}
