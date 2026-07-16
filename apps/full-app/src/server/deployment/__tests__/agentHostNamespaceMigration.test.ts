import { readFile } from 'node:fs/promises'
import path from 'node:path'

import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const SCHEMA = `agent_host_namespace_${Date.now()}_${Math.random().toString(36).slice(2)}`
const HISTORICAL_MIGRATIONS = [
  '0018_d1_binding_admissions.sql',
  '0019_d1_destructive_publication_events.sql',
  '0020_d1_admission_execution_identity.sql',
  '0021_d1_rollback_source_provenance.sql',
] as const
const NAMESPACE_MIGRATION = '0022_agent_host_namespace.sql'
const DIGEST_A = `sha256:${'a'.repeat(64)}`
const DIGEST_B = `sha256:${'b'.repeat(64)}`

interface SequencePosition { lastValue: string | number | bigint; isCalled: boolean }
interface AdmissionRow {
  sequence: string | number | bigint
  hostId: string
  bindingId: string
  activeRevision: string
  executionIdentityDigest: string | null
  firstDesiredStateDigest: string | null
  admittedAt: Date
}
interface PublicationRow {
  sequence: string | number | bigint
  operationId: string
  state: string
  hostId: string
  expectedRevision: string
  expectedDigest: string
  targetRevision: string
  targetDigest: string
  sourceRevision: string | null
  sourceDigest: string | null
  removalBindingIds: string[]
  recordedAt: Date
}

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
  for (const migration of HISTORICAL_MIGRATIONS) await applyMigration(migration)
}, 30_000)

afterAll(async () => {
  await connection?.release()
  if (admin) {
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${quotedIdentifier(SCHEMA)} CASCADE`)
    await admin.end()
  }
})

describe.sequential('agent-host namespace forward migration', () => {
  it('preserves 0018-0021 rows and sequence positions while upgrading catalog and behavior', async () => {
    await connection`
      INSERT INTO d1_binding_admissions
        (host_id, binding_id, active_revision, execution_identity_digest, first_desired_state_digest, admitted_at)
      VALUES ('sentinel-host', 'sentinel-binding', 'r0000000041', ${DIGEST_A}, ${DIGEST_B}, '2026-07-15T00:00:00.000Z')
    `
    await connection`
      INSERT INTO d1_destructive_publication_events
        (operation_id, state, host_id, expected_revision, expected_digest, target_revision, target_digest,
          source_revision, source_digest, removal_binding_ids, recorded_at)
      VALUES ('sentinel-operation', 'prepared', 'sentinel-host', 'r0000000040', ${DIGEST_A}, 'r0000000041', ${DIGEST_B},
        'r0000000039', ${DIGEST_A}, ARRAY['sentinel-binding'], '2026-07-15T00:00:01.000Z')
    `

    const [admissionBefore] = await connection<AdmissionRow[]>`
      SELECT sequence, host_id AS "hostId", binding_id AS "bindingId", active_revision AS "activeRevision",
        execution_identity_digest AS "executionIdentityDigest", first_desired_state_digest AS "firstDesiredStateDigest",
        admitted_at AS "admittedAt"
      FROM d1_binding_admissions WHERE host_id = 'sentinel-host' AND binding_id = 'sentinel-binding'
    `
    const [publicationBefore] = await connection<PublicationRow[]>`
      SELECT sequence, operation_id AS "operationId", state, host_id AS "hostId",
        expected_revision AS "expectedRevision", expected_digest AS "expectedDigest",
        target_revision AS "targetRevision", target_digest AS "targetDigest",
        source_revision AS "sourceRevision", source_digest AS "sourceDigest",
        removal_binding_ids AS "removalBindingIds", recorded_at AS "recordedAt"
      FROM d1_destructive_publication_events WHERE operation_id = 'sentinel-operation'
    `
    const [admissionSequenceBefore] = await connection<SequencePosition[]>`
      SELECT last_value AS "lastValue", is_called AS "isCalled" FROM d1_binding_admissions_sequence_seq
    `
    const [publicationSequenceBefore] = await connection<SequencePosition[]>`
      SELECT last_value AS "lastValue", is_called AS "isCalled" FROM d1_destructive_publication_events_sequence_seq
    `
    expect(admissionBefore).toBeDefined()
    expect(publicationBefore).toBeDefined()
    expect(admissionSequenceBefore).toMatchObject({ isCalled: true })
    expect(publicationSequenceBefore).toMatchObject({ isCalled: true })

    await applyMigration(NAMESPACE_MIGRATION)

    const [admissionAfter] = await connection<AdmissionRow[]>`
      SELECT sequence, host_id AS "hostId", binding_id AS "bindingId", active_revision AS "activeRevision",
        execution_identity_digest AS "executionIdentityDigest", first_desired_state_digest AS "firstDesiredStateDigest",
        admitted_at AS "admittedAt"
      FROM agent_host_binding_admissions WHERE host_id = 'sentinel-host' AND binding_id = 'sentinel-binding'
    `
    const [publicationAfter] = await connection<PublicationRow[]>`
      SELECT sequence, operation_id AS "operationId", state, host_id AS "hostId",
        expected_revision AS "expectedRevision", expected_digest AS "expectedDigest",
        target_revision AS "targetRevision", target_digest AS "targetDigest",
        source_revision AS "sourceRevision", source_digest AS "sourceDigest",
        removal_binding_ids AS "removalBindingIds", recorded_at AS "recordedAt"
      FROM agent_host_destructive_publication_events WHERE operation_id = 'sentinel-operation'
    `
    expect(admissionAfter).toEqual(admissionBefore)
    expect(publicationAfter).toEqual(publicationBefore)

    const [admissionSequenceAfter] = await connection<SequencePosition[]>`
      SELECT last_value AS "lastValue", is_called AS "isCalled" FROM agent_host_binding_admissions_sequence_seq
    `
    const [publicationSequenceAfter] = await connection<SequencePosition[]>`
      SELECT last_value AS "lastValue", is_called AS "isCalled" FROM agent_host_destructive_publication_events_sequence_seq
    `
    expect(admissionSequenceAfter).toEqual(admissionSequenceBefore)
    expect(publicationSequenceAfter).toEqual(publicationSequenceBefore)

    const [nextAdmission] = await connection<{ sequence: string | number | bigint }[]>`
      INSERT INTO agent_host_binding_admissions
        (host_id, binding_id, active_revision, execution_identity_digest, first_desired_state_digest)
      VALUES ('sentinel-host', 'next-binding', 'r0000000042', ${DIGEST_B}, ${DIGEST_A})
      RETURNING sequence
    `
    const [nextPublication] = await connection<{ sequence: string | number | bigint }[]>`
      INSERT INTO agent_host_destructive_publication_events
        (operation_id, state, host_id, expected_revision, expected_digest, target_revision, target_digest, removal_binding_ids)
      VALUES ('next-operation', 'prepared', 'sentinel-host', 'r0000000041', ${DIGEST_B}, 'r0000000042', ${DIGEST_A}, ARRAY['next-binding'])
      RETURNING sequence
    `
    expect(BigInt(nextAdmission!.sequence)).toBe(BigInt(admissionSequenceBefore!.lastValue) + 1n)
    expect(BigInt(nextPublication!.sequence)).toBe(BigInt(publicationSequenceBefore!.lastValue) + 1n)

    const relations = await connection<{ name: string }[]>`
      SELECT relation.relname AS name
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

    let mutationMessage = ''
    try {
      await connection`UPDATE agent_host_destructive_publication_events SET state = 'aborted' WHERE operation_id = 'sentinel-operation'`
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
