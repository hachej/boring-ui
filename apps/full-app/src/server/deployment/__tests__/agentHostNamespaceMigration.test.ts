import { readFile } from 'node:fs/promises'
import path from 'node:path'

import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const SCHEMA = `agent_host_namespace_${Date.now()}_${Math.random().toString(36).slice(2)}`
const MIGRATIONS = [
  '0018_d1_binding_admissions.sql',
  '0019_d1_destructive_publication_events.sql',
  '0020_d1_admission_execution_identity.sql',
  '0021_d1_rollback_source_provenance.sql',
  '0022_agent_host_namespace.sql',
] as const
const DIGEST = `sha256:${'a'.repeat(64)}`

let admin: postgres.Sql
let connection: postgres.ReservedSql

function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

async function applyMigration(file: string): Promise<void> {
  const migrationPath = path.resolve(process.cwd(), '../../packages/core/drizzle', file)
  const source = await readFile(migrationPath, 'utf8')
  for (const statement of source.split('--> statement-breakpoint').map((value) => value.trim()).filter(Boolean)) {
    await connection.unsafe(statement)
  }
}

beforeAll(async () => {
  admin = postgres(DATABASE_URL, { max: 1 })
  await admin.unsafe(`CREATE SCHEMA ${quotedIdentifier(SCHEMA)}`)
  connection = await admin.reserve()
  await connection.unsafe(`SET search_path TO ${quotedIdentifier(SCHEMA)}`)
  for (const migration of MIGRATIONS) await applyMigration(migration)
}, 30_000)

afterAll(async () => {
  await connection?.release()
  if (admin) {
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${quotedIdentifier(SCHEMA)} CASCADE`)
    await admin.end()
  }
})

describe.sequential('agent-host namespace forward migration', () => {
  it('applies 0018-0022 cleanly and leaves only working agent-host catalog and behavior', async () => {
    const relations = await connection<{ name: string; kind: string }[]>`
      SELECT relation.relname AS name, relation.relkind AS kind
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = ${SCHEMA}
      ORDER BY relation.relname
    `
    expect(relations.map((value) => value.name)).toEqual(expect.arrayContaining([
      'agent_host_binding_admissions',
      'agent_host_binding_admissions_sequence_seq',
      'agent_host_destructive_publication_events',
      'agent_host_destructive_publication_events_sequence_seq',
    ]))
    expect(relations.filter((value) => value.name.toLowerCase().includes('d1'))).toEqual([])

    const constraints = await connection<{ name: string; type: string }[]>`
      SELECT constraint_catalog.conname AS name, constraint_catalog.contype AS type
      FROM pg_constraint constraint_catalog
      JOIN pg_class relation ON relation.oid = constraint_catalog.conrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = ${SCHEMA}
      ORDER BY constraint_catalog.conname
    `
    expect(constraints.filter((value) => value.name.toLowerCase().includes('d1'))).toEqual([])
    expect(constraints.filter((value) => value.type === 'n').every((value) => value.name.startsWith('agent_host_'))).toBe(true)

    const routines = await connection<{ name: string; source: string }[]>`
      SELECT routine.proname AS name, routine.prosrc AS source
      FROM pg_proc routine
      JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = ${SCHEMA}
    `
    expect(routines).toEqual([expect.objectContaining({ name: 'agent_host_reject_destructive_publication_event_mutation' })])
    expect(JSON.stringify(routines)).not.toMatch(/d1/i)

    const triggers = await connection<{ name: string }[]>`
      SELECT trigger.tgname AS name
      FROM pg_trigger trigger
      JOIN pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = ${SCHEMA} AND NOT trigger.tgisinternal
      ORDER BY trigger.tgname
    `
    expect(triggers.map((value) => value.name)).toEqual([
      'agent_host_destructive_publication_events_immutable',
      'agent_host_destructive_publication_events_truncate_immutable',
    ])

    const requiredColumns = await connection<{ tableName: string; columnName: string }[]>`
      SELECT table_name AS "tableName", column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = ${SCHEMA}
        AND table_name IN ('agent_host_binding_admissions', 'agent_host_destructive_publication_events')
        AND is_nullable = 'NO'
    `
    expect(requiredColumns).toHaveLength(15)

    const [firstAdmission] = await connection<{ sequence: bigint }[]>`
      INSERT INTO agent_host_binding_admissions
        (host_id, binding_id, active_revision, execution_identity_digest, first_desired_state_digest)
      VALUES ('host-1', 'alpha', 'r0000000001', ${DIGEST}, ${DIGEST})
      RETURNING sequence
    `
    const [secondAdmission] = await connection<{ sequence: bigint }[]>`
      INSERT INTO agent_host_binding_admissions
        (host_id, binding_id, active_revision, execution_identity_digest, first_desired_state_digest)
      VALUES ('host-1', 'beta', 'r0000000001', ${DIGEST}, ${DIGEST})
      RETURNING sequence
    `
    expect(BigInt(secondAdmission!.sequence)).toBe(BigInt(firstAdmission!.sequence) + 1n)

    const [publication] = await connection<{ sequence: bigint }[]>`
      INSERT INTO agent_host_destructive_publication_events
        (operation_id, state, host_id, expected_revision, expected_digest, target_revision, target_digest, removal_binding_ids)
      VALUES ('operation-1', 'prepared', 'host-1', 'r0000000001', ${DIGEST}, 'r0000000002', ${DIGEST}, ARRAY['beta'])
      RETURNING sequence
    `
    expect(BigInt(publication!.sequence)).toBeGreaterThan(0n)

    let mutationMessage = ''
    try {
      await connection`UPDATE agent_host_destructive_publication_events SET state = 'aborted' WHERE operation_id = 'operation-1'`
    } catch (error) {
      mutationMessage = error instanceof Error ? error.message : String(error)
    }
    expect(mutationMessage).toContain('agent-host destructive publication events are immutable')
    expect(mutationMessage).not.toMatch(/d1/i)

    const oldObjects = await connection<{ bindingTable: string | null; publicationTable: string | null }[]>`
      SELECT
        to_regclass(${`${SCHEMA}.d1_binding_admissions`})::text AS "bindingTable",
        to_regclass(${`${SCHEMA}.d1_destructive_publication_events`})::text AS "publicationTable"
    `
    expect(oldObjects).toEqual([{ bindingTable: null, publicationTable: null }])
  })
})
