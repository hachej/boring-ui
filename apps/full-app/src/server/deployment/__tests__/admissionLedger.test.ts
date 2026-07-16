import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from '@hachej/boring-core/server'
import type { CoreConfig } from '@hachej/boring-core/shared'

import type { AgentHostActiveCollection, AgentHostActiveCollectionReader } from '../activeCollectionReader.js'
import {
  createAgentHostAdmissionLedger,
  mintAttestedAgentHostDatabaseConnection,
  type AgentHostAdmissionTarget,
} from '../admissionLedger.js'
import { AgentHostErrorCode } from '../agentHostPlan.js'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2)}`
const HOST = `agent-host-admission-${RUN}`
const digest = (character: string) => `sha256:${character.repeat(64)}`
const target = (bindingId = 'insurance'): AgentHostAdmissionTarget => ({
  hostId: HOST, bindingId, workspaceId: `workspace:${bindingId}`, defaultDeploymentId: `deployment:${bindingId}`,
})
const reader = (
  revisionId: string,
  value = target(),
  databaseRef = 'postgres-eu',
  options: { readonly hostname?: string; readonly landing?: string; readonly execution?: string; readonly desired?: string } = {},
): AgentHostActiveCollectionReader => ({
  async read() {
    const execution = options.execution ?? 'b'
    const planBinding = {
      ...value,
      hostname: options.hostname ?? `${value.bindingId}.example.com`, bundleRef: 'bundle-v1', deploymentRef: 'deployment-v1',
      workspaceAllocationRef: 'workspace-allocation-v1', sessionAllocationRef: 'session-allocation-v1',
      ownerPrincipalRef: 'owner-v1', landing: { title: options.landing ?? 'Agent', summary: 'Summary' },
      environmentRef: 'environment-v1', secretRefs: [],
    }
    return {
      active: { schemaVersion: 1, revisionId, desiredStateDigest: digest(options.desired ?? 'a') },
      desired: {
        plan: { hostId: HOST, databaseRef, bindings: [planBinding] },
        resolvedBindings: [{
          schemaVersion: 1, bindingId: value.bindingId,
          composition: { snapshot: { workspaceId: value.workspaceId }, digest: digest(execution) },
          workspace: { ...value, compositionDigest: digest(execution) },
          deployment: { deploymentId: value.defaultDeploymentId, version: 'v1', agentId: 'default', digest: digest(execution) },
          definition: { definitionId: 'definition-v1', version: 'v1', digest: digest(execution), instructionsRef: 'instructions.md' },
          resolvedDigest: digest(execution),
        }],
      },
      observation: { bindings: [{
        bindingId: value.bindingId,
        runtimeInputs: {
          schemaVersion: 1, domain: 'boring-agent-host-runtime-inputs:v1', bindingId: value.bindingId,
          environment: { ref: 'environment-v1', versionFingerprint: digest(execution) },
          workspaceAllocation: { ref: 'workspace-allocation-v1', versionFingerprint: digest(execution) },
          sessionAllocation: { ref: 'session-allocation-v1', versionFingerprint: digest(execution) },
          secrets: [], digest: digest(execution),
        },
      }] },
    } as unknown as AgentHostActiveCollection
  },
})

let sql: postgres.Sql
const ledger = (client = sql, ownsClient = false) => createAgentHostAdmissionLedger(
  mintAttestedAgentHostDatabaseConnection('postgres-eu', client, { ownsClient }),
)

beforeAll(async () => {
  await runMigrations({ databaseUrl: DATABASE_URL } as CoreConfig)
  sql = postgres(DATABASE_URL, { max: 8 })
})
afterAll(async () => {
  if (!sql) return
  await sql`DELETE FROM agent_host_binding_admissions WHERE host_id = ${HOST}`
  await sql.end()
})

describe('AgentHost admission ledger', () => {
  it('migrates an identity-sequenced composite-key ledger', async () => {
    const columns = await sql`
      SELECT column_name, is_identity, data_type FROM information_schema.columns
      WHERE table_name = 'agent_host_binding_admissions' ORDER BY ordinal_position
    `
    expect(columns.map((column) => column.column_name)).toEqual([
      'sequence', 'host_id', 'binding_id', 'active_revision', 'admitted_at',
      'execution_identity_digest', 'first_desired_state_digest',
    ])
    expect(columns[0]).toMatchObject({ is_identity: 'YES', data_type: 'bigint' })
    expect(columns[4]).toMatchObject({ data_type: 'timestamp with time zone' })
  })

  it('converges concurrent admission and preserves identity across surface-only revisions', async () => {
    const first = ledger(postgres(DATABASE_URL, { max: 2 }), true); const second = ledger(postgres(DATABASE_URL, { max: 2 }), true)
    const [left, right] = await Promise.all([
      first.admit(reader('r0000000001'), target()), second.admit(reader('r0000000002'), target()),
    ])
    expect(right).toEqual(left)
    const advanced = await first.admit(reader('r0000000003', target(), 'postgres-eu', {
      hostname: 'updated.example.com', landing: 'Updated', desired: 'c',
    }), target())
    expect(advanced).toEqual(left); expect(['r0000000001', 'r0000000002']).toContain(left.firstRevisionId)
    expect(left.executionIdentityDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(left.firstDesiredStateDigest).toBe(digest('a'))
    await Promise.all([first.close(), second.close()])
  })

  it('keeps the committed fence after restart when the revision collection is unavailable', async () => {
    const value = target('crash-fence'); const first = ledger(postgres(DATABASE_URL, { max: 2 }), true)
    await first.admit(reader('r0000000004', value), value)
    await first.close()
    const restarted = ledger(postgres(DATABASE_URL, { max: 2 }), true)
    await expect(restarted.admit({ read: async () => null }, value)).rejects.toMatchObject({
      code: AgentHostErrorCode.ADMISSION_RECORD_FAILED,
    })
    expect(await restarted.listBindingIds(HOST, 'postgres-eu')).toContain('crash-fence')
    await restarted.close()
  })

  it('rejects binding-id reuse with changed execution facts before effect', async () => {
    const value = target('identity'); const admission = ledger(); let effect = false
    await admission.admit(reader('r0000000005', value, 'postgres-eu', { execution: 'd' }), value)
    await expect(admission.admit(reader('r0000000006', value, 'postgres-eu', { execution: 'e' }), value)
      .then(() => { effect = true })).rejects.toMatchObject({
      code: AgentHostErrorCode.ADMISSION_IDENTITY_MISMATCH,
      details: { field: 'executionIdentityDigest' },
    })
    expect(effect).toBe(false)
  })

  it('keeps legacy pre-0020 rows fenced without inferring an execution identity', async () => {
    const value = target('legacy')
    await sql`INSERT INTO agent_host_binding_admissions (host_id, binding_id, active_revision)
      VALUES (${HOST}, ${value.bindingId}, 'r0000000001')`
    await expect(ledger().admit(reader('r0000000002', value), value)).rejects.toMatchObject({
      code: AgentHostErrorCode.ADMISSION_IDENTITY_MISMATCH,
    })
    expect(await ledger().listBindingIds(HOST, 'postgres-eu')).toContain(value.bindingId)
  })

  it('rechecks after waiting while allowing another binding to proceed', async () => {
    const first = ledger(); const second = ledger(); const third = ledger(); let release!: () => void
    await Promise.all([first.withBindingFences([target('zulu'), target('alpha')], async () => {}), second.withBindingFences([target('alpha'), target('zulu')], async () => {})])
    const waiting = target('waiting'); let entered = false; let effect = false; let active: AgentHostActiveCollectionReader = reader('r0000000004', waiting)
    const held = first.withBindingFences([waiting], async () => {
      entered = true; await new Promise<void>((resolve) => { release = resolve })
    })
    while (!entered) await new Promise((resolve) => setTimeout(resolve, 5))
    const contender = second.admit({ read: () => active.read() }, waiting).then(() => { effect = true }).catch((error: unknown) => error)
    await third.withBindingFences([target('travel')], async () => {})
    active = { read: async () => null }; expect(effect).toBe(false); release(); await held
    expect(await contender).toMatchObject({ code: AgentHostErrorCode.ADMISSION_RECORD_FAILED }); expect(effect).toBe(false)
    expect(await second.listBindingIds(HOST, 'postgres-eu')).not.toContain('waiting')
  })

  it('rejects database/workspace drift before inserting', async () => {
    const value = target('drift'); const admission = ledger()
    for (const active of [reader('r0000000004', { ...value, workspaceId: 'workspace:other' }), reader('r0000000004', value, 'postgres-other')]) {
      await expect(admission.admit(active, value)).rejects.toMatchObject({ code: AgentHostErrorCode.ADMISSION_RECORD_FAILED })
    }
    expect(await admission.listBindingIds(HOST, 'postgres-eu')).not.toContain('drift')
  })

  it('fails closed and releases session fences when the backend connection dies', async () => {
    const owned = postgres(DATABASE_URL, { max: 2 }); const admission = ledger(owned, true)
    await expect(admission.withBindingFences([target('lost')], async (reserved) => {
      const [backend] = await reserved<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
      await sql`SELECT pg_terminate_backend(${backend!.pid})`
    })).rejects.toMatchObject({ code: AgentHostErrorCode.ADMISSION_RECORD_FAILED })
    await ledger().withBindingFences([target('lost')], async () => {})
    await admission.close()
  }, 15_000)

  it('does not admit an effect when COMMIT fails', async () => {
    const isolated = postgres(DATABASE_URL, { max: 1 })
    await isolated`CREATE TEMP TABLE allowed_revisions (revision text PRIMARY KEY)`
    await isolated`CREATE TEMP TABLE agent_host_destructive_publication_events (
      operation_id text NOT NULL, state text NOT NULL, host_id text NOT NULL, removal_binding_ids text[] NOT NULL
    )`
    await isolated`CREATE TEMP TABLE agent_host_binding_admissions (
      sequence bigint GENERATED ALWAYS AS IDENTITY,
      host_id text NOT NULL,
      binding_id text NOT NULL,
      active_revision text NOT NULL REFERENCES allowed_revisions(revision) DEFERRABLE INITIALLY DEFERRED,
      admitted_at timestamptz DEFAULT now() NOT NULL,
      execution_identity_digest text NOT NULL,
      first_desired_state_digest text NOT NULL,
      PRIMARY KEY (host_id, binding_id)
    )`
    await isolated`SET search_path TO pg_temp, public`
    const admission = ledger(isolated, true); let effect = false
    await expect(admission.admit(reader('r0000000007'), target('commit-failure'))
      .then(() => { effect = true })).rejects.toMatchObject({ code: AgentHostErrorCode.ADMISSION_RECORD_FAILED })
    expect(effect).toBe(false)
    expect(await isolated`SELECT 1 FROM agent_host_binding_admissions`).toHaveLength(0)
    await admission.close()
  })
})
