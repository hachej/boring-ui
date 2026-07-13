import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from '@hachej/boring-core/server'
import type { CoreConfig } from '@hachej/boring-core/shared'

import type { D1ActiveCollection, D1ActiveCollectionReader } from '../activeCollectionReader.js'
import {
  createD1AdmissionLedger,
  mintAttestedD1DatabaseConnection,
  type D1AdmissionTarget,
} from '../admissionLedger.js'
import { D1HostErrorCode } from '../d1Plan.js'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2)}`
const HOST = `d1-admission-${RUN}`
const target = (bindingId = 'insurance'): D1AdmissionTarget => ({
  hostId: HOST, bindingId, workspaceId: `workspace:${bindingId}`, defaultDeploymentId: `deployment:${bindingId}`,
})
const reader = (revisionId: string, value = target(), databaseRef = 'postgres-eu'): D1ActiveCollectionReader => ({
  async read() {
    return {
      active: { schemaVersion: 1, revisionId, desiredStateDigest: `sha256:${'a'.repeat(64)}` },
      desired: {
        plan: { hostId: HOST, databaseRef, bindings: [value] },
        resolvedBindings: [{ bindingId: value.bindingId, workspace: value }],
      },
    } as unknown as D1ActiveCollection
  },
})

let sql: postgres.Sql
const ledger = (client = sql, ownsClient = false) => createD1AdmissionLedger(
  mintAttestedD1DatabaseConnection('postgres-eu', client, { ownsClient }),
)

beforeAll(async () => {
  await runMigrations({ databaseUrl: DATABASE_URL } as CoreConfig)
  sql = postgres(DATABASE_URL, { max: 8 })
})
afterAll(async () => {
  if (!sql) return
  await sql`DELETE FROM d1_binding_admissions WHERE host_id = ${HOST}`
  await sql.end()
})

describe('D1 admission ledger', () => {
  it('migrates an identity-sequenced composite-key ledger', async () => {
    const columns = await sql`
      SELECT column_name, is_identity, data_type FROM information_schema.columns
      WHERE table_name = 'd1_binding_admissions' ORDER BY ordinal_position
    `
    expect(columns.map((column) => column.column_name)).toEqual(['sequence', 'host_id', 'binding_id', 'active_revision', 'admitted_at'])
    expect(columns[0]).toMatchObject({ is_identity: 'YES', data_type: 'bigint' })
    expect(columns[4]).toMatchObject({ data_type: 'timestamp with time zone' })
  })

  it('converges concurrent admission, accepts an additive revision, and reloads after restart', async () => {
    const first = ledger(postgres(DATABASE_URL, { max: 2 }), true); const second = ledger(postgres(DATABASE_URL, { max: 2 }), true)
    const [left, right] = await Promise.all([
      first.admit(reader('r0000000001'), target()), second.admit(reader('r0000000002'), target()),
    ])
    expect(right).toEqual(left)
    const advanced = await first.admit(reader('r0000000003'), target())
    expect(advanced).toEqual(left); expect(['r0000000001', 'r0000000002']).toContain(left.activeRevision)
    await Promise.all([first.close(), second.close()])
    const restarted = ledger(postgres(DATABASE_URL, { max: 2 }), true)
    expect(await restarted.listBindingIds(HOST, 'postgres-eu')).toEqual(['insurance'])
    await restarted.close()
  })

  it('rechecks after waiting while allowing another binding to proceed', async () => {
    const first = ledger(); const second = ledger(); const third = ledger(); let release!: () => void
    await Promise.all([first.withBindingFences([target('zulu'), target('alpha')], async () => {}), second.withBindingFences([target('alpha'), target('zulu')], async () => {})])
    const waiting = target('waiting'); let entered = false; let effect = false; let active: D1ActiveCollectionReader = reader('r0000000004', waiting)
    const held = first.withBindingFences([waiting], async () => {
      entered = true; await new Promise<void>((resolve) => { release = resolve })
    })
    while (!entered) await new Promise((resolve) => setTimeout(resolve, 5))
    const contender = second.admit({ read: () => active.read() }, waiting).then(() => { effect = true }).catch((error: unknown) => error)
    await third.withBindingFences([target('travel')], async () => {})
    active = { read: async () => null }; expect(effect).toBe(false); release(); await held
    expect(await contender).toMatchObject({ code: D1HostErrorCode.ADMISSION_RECORD_FAILED }); expect(effect).toBe(false)
    expect(await second.listBindingIds(HOST, 'postgres-eu')).not.toContain('waiting')
  })

  it('rejects database/workspace drift before inserting', async () => {
    const value = target('drift'); const admission = ledger()
    for (const active of [reader('r0000000004', { ...value, workspaceId: 'workspace:other' }), reader('r0000000004', value, 'postgres-other')]) {
      await expect(admission.admit(active, value)).rejects.toMatchObject({ code: D1HostErrorCode.ADMISSION_RECORD_FAILED })
    }
    expect(await admission.listBindingIds(HOST, 'postgres-eu')).not.toContain('drift')
  })

  it('fails closed and releases session fences when the backend connection dies', async () => {
    const owned = postgres(DATABASE_URL, { max: 2 }); const admission = ledger(owned, true)
    await expect(admission.withBindingFences([target('lost')], async (reserved) => {
      const [backend] = await reserved<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
      await sql`SELECT pg_terminate_backend(${backend!.pid})`
    })).rejects.toMatchObject({ code: D1HostErrorCode.ADMISSION_RECORD_FAILED })
    await ledger().withBindingFences([target('lost')], async () => {})
    await admission.close()
  }, 15_000)
})
