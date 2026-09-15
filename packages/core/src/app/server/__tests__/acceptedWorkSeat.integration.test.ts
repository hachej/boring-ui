import {
  SqliteAgentRequestLedger,
  createAgentHost,
  createSandboxRuntimeModeAdapter,
  type AgentRequestKey,
} from '@hachej/boring-agent/server'
import type { AuthorizedAgentScope } from '@hachej/boring-agent/shared'
import { drizzle } from 'drizzle-orm/postgres-js'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { expect, test } from 'vitest'
import { createTestCoreConfig } from '../../../server/__tests__/createTestApp.js'
import { runMigrations } from '../../../server/db/migrate.js'
import { PostgresWorkspaceStore } from '../../../server/db/stores/PostgresWorkspaceStore.js'
import { resolveCanonicalAgentAccess } from '../canonicalAgentAccess.js'

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'

test('real Core Seats become accepted-work participation through AgentHost and SQLite reopen', async () => {
  const config = createTestCoreConfig({ stores: 'postgres', databaseUrl })
  await runMigrations(config)
  const sql = postgres(databaseUrl, { max: 2 })
  const workspaceStore = new PostgresWorkspaceStore(drizzle(sql), config.encryption.workspaceSettingsKey)
  const root = await mkdtemp(join(tmpdir(), 'core-agent-seat-accepted-work-'))
  const ledgerPath = join(root, 'requests.sqlite')
  const appId = `accepted-work-${randomUUID()}`
  const email = `${appId}@accepted-work-test.dev`
  let host: Awaited<ReturnType<typeof createAgentHost>> | undefined

  try {
    const [user] = await sql`
      INSERT INTO users (name, email, email_verified)
      VALUES ('Accepted Work Owner', ${email}, true)
      RETURNING id
    `
    const userId = user.id as string
    const workspace = await workspaceStore.create(userId, 'Accepted Work', appId, {
      defaultAgentTypeId: 'alpha',
      initialAgentSeatSource: 'operator',
      additionalAgentSeat: { agentTypeId: 'beta', source: 'operator' },
      enrolledByUserId: userId,
    })
    const persistedSeats = await workspaceStore.listAgentSeats(workspace.id)
    expect(persistedSeats.map(({ agentTypeId }) => agentTypeId)).toEqual(['alpha', 'beta'])

    const databaseRows = await sql`
      SELECT seat_id, agent_type_id
      FROM workspace_agent_seats
      WHERE workspace_id = ${workspace.id}
      ORDER BY agent_type_id
    `
    expect(databaseRows).toEqual(persistedSeats.map((seat) => ({
      seat_id: seat.seatId,
      agent_type_id: seat.agentTypeId,
    })))

    const forgedSeatIds = new Map([
      ['alpha', 'forged-entitlement-seat-alpha'],
      ['beta', 'forged-entitlement-seat-beta'],
    ])
    const scope = {
      workspaceScopeId: workspace.id,
      authSubjectId: userId,
    } as AuthorizedAgentScope

    host = await createAgentHost({
      agents: [
        { agentTypeId: 'alpha', definition: { instructions: 'alpha', label: 'Alpha' } },
        { agentTypeId: 'beta', definition: { instructions: 'beta', label: 'Beta' } },
      ],
      fleetCompiler: { compile: async ({ agents }) => agents },
      scopeVerifier: {
        verify: async (authorizedScope) => ({
          workspaceScopeId: authorizedScope.workspaceScopeId,
          authSubjectId: authorizedScope.authSubjectId,
        }),
      },
      resolveAgentAccess: async ({ verifiedClaim, agentTypeId, operation }) =>
        await resolveCanonicalAgentAccess({
          workspaceStore,
          workspaceId: verifiedClaim.workspaceScopeId,
          userId: verifiedClaim.authSubjectId,
          agentTypeId,
          operation,
          resolveAgentEntitlement: async ({ agentTypeId: entitledAgentTypeId }) => ({
            state: 'allowed',
            seatId: forgedSeatIds.get(entitledAgentTypeId)!,
          }),
        }),
      runtimeModeAdapter: createSandboxRuntimeModeAdapter('direct'),
      sessionRoot: root,
      requestLedgerPath: ledgerPath,
      resolveAuthorizedEnvironmentScope: async () => ({
        placementIdentity: 'direct:accepted-work',
        workspaceRoot: root,
        provisioningFingerprint: 'accepted-work:v1',
      }),
      resolveAuthorizedAgentRuntimeScope: async ({ agentTypeId }) => ({
        identity: `accepted-work:${agentTypeId}`,
        physicalBindingIdentity: `accepted-work:${agentTypeId}`,
        resourceInputDigest: `accepted-work:${agentTypeId}`,
        sessionNamespace: `accepted-work-${agentTypeId}`,
      }),
    })

    const keys: AgentRequestKey[] = []
    const createdAgents: string[] = []
    for (const agentTypeId of ['alpha', 'beta']) {
      const requestId = `create-${agentTypeId}`
      const ref = await host.gateway.createSession({
        scope,
        agentTypeId,
        requestId,
        title: `Accepted ${agentTypeId}`,
      })
      createdAgents.push(ref.agentTypeId)
      keys.push({
        workspaceScopeId: workspace.id,
        authSubjectId: userId,
        operation: 'session.create',
        target: { kind: 'agent', agentTypeId },
        requestId,
      })
    }
    expect(createdAgents).toEqual(['alpha', 'beta'])

    await host.host.close()
    host = undefined

    const reopened = new SqliteAgentRequestLedger(ledgerPath)
    try {
      for (const key of keys) {
        if (key.target.kind !== 'agent') throw new TypeError('expected Agent target')
        const agentTypeId = key.target.agentTypeId
        const record = await reopened.read(key)
        const canonicalSeatId = persistedSeats.find((seat) => seat.agentTypeId === agentTypeId)!.seatId
        expect(record).toMatchObject({
          state: 'completed',
          acceptedWork: {
            identity: {
              agent: { agentTypeId },
              participation: { seatId: canonicalSeatId },
            },
          },
        })
        expect(JSON.stringify(record?.acceptedWork)).not.toContain(forgedSeatIds.get(agentTypeId))
        expect(record?.acceptedWork.identity.participation?.seatId).not.toBe(forgedSeatIds.get(agentTypeId))
      }
    } finally {
      reopened.close()
    }
  } finally {
    await host?.host.close()
    await sql`DELETE FROM workspace_agent_seats WHERE workspace_id IN (SELECT id FROM workspaces WHERE app_id = ${appId})`
    await sql`DELETE FROM workspace_members WHERE workspace_id IN (SELECT id FROM workspaces WHERE app_id = ${appId})`
    await sql`DELETE FROM workspaces WHERE app_id = ${appId}`
    await sql`DELETE FROM users WHERE email = ${email}`
    await sql.end()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
