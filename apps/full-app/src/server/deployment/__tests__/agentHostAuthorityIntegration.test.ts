import { randomBytes } from 'node:crypto'
import { access, chmod, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import { runMigrations } from '@hachej/boring-core/server'
import type { CoreConfig } from '@hachej/boring-core/shared'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'

import { createAgentHostDestructivePublicationJournalStore } from '../destructivePublicationJournal.js'
import { runAgentHostRevisionWrapper } from '../agentHostCommandWrapper.js'
import { createAgentHostAuthorityFixture, AGENT_HOST_AUTHORITY_TEST_HOST } from './agentHostAuthorityFixture.js'
import { createAgentHostAuthorityIntegrationState } from './agentHostAuthorityIntegrationSupport.js'

const BASE_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'

async function createIsolatedDatabase(): Promise<{ databaseRef: string; databaseUrl: string; admin: postgres.Sql }> {
  const suffix = `${Date.now()}_${randomBytes(4).toString('hex')}`; const databaseRef = `agent_host_proof_${suffix}`
  const password = randomBytes(24).toString('hex'); const admin = postgres(BASE_DATABASE_URL, { max: 2 })
  await admin.unsafe(`CREATE ROLE "${databaseRef}" LOGIN PASSWORD '${password}'`)
  await admin.unsafe(`CREATE DATABASE "${databaseRef}" OWNER "${databaseRef}"`)
  const url = new URL(BASE_DATABASE_URL); url.username = databaseRef; url.password = password; url.pathname = `/${databaseRef}`
  const databaseUrl = url.toString(); await runMigrations({ databaseUrl } as CoreConfig)
  return { databaseRef, databaseUrl, admin }
}

describe('AgentHost isolated authority runtime crossing', () => {
  it('carries FD4 through protected postgres apply/rollback and lost-ack recovery, then closes the owned client', async () => {
    const isolated = await createIsolatedDatabase(); const fixture = await createAgentHostAuthorityFixture(isolated)
    const state = await createAgentHostAuthorityIntegrationState(AGENT_HOST_AUTHORITY_TEST_HOST, isolated.databaseRef)
    const operationId = `authority-lost-ack-${Date.now()}`
    const identity = { operationId, hostId: AGENT_HOST_AUTHORITY_TEST_HOST, expectedRevision: state.completeOne.revisionId,
      expectedDigest: state.completeOne.desiredStateDigest, targetRevision: state.completeTwo.revisionId,
      targetDigest: state.completeTwo.desiredStateDigest, removalBindingIds: ['lost'] }
    const proofSql = postgres(isolated.databaseUrl, { max: 1 }); const reserved = await proofSql.reserve()
    try { await createAgentHostDestructivePublicationJournalStore().appendPrepared(reserved, identity) }
    finally { reserved.release(); await proofSql.end() }

    const normalRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-host-normal-untouched-')); await chmod(normalRoot, 0o700)
    const normalState = path.join(normalRoot, 'state'); const normalLocks = path.join(normalRoot, 'locks')
    await mkdir(normalState, { mode: 0o700 }); await mkdir(normalLocks, { mode: 0o700 }); await chmod(normalState, 0o700); await chmod(normalLocks, 0o700)
    await writeFile(path.join(normalState, 'production-marker'), 'untouched', { mode: 0o400 })
    await writeFile(path.join(normalLocks, `${AGENT_HOST_AUTHORITY_TEST_HOST}.lock`), '', { mode: 0o600 })
    const env = {
      ...process.env,
      BORING_AGENT_HOST_AUTHORITY_FILE: fixture.descriptorFile,
      BORING_AGENT_HOST_OWNER_UID: String(process.geteuid!()),
      BORING_AGENT_HOST_STATE_ROOT: normalState,
      BORING_AGENT_HOST_LOCK_ROOT: normalLocks,
      AGENT_HOST_INTEGRATION_HOST_ID: AGENT_HOST_AUTHORITY_TEST_HOST,
      AGENT_HOST_INTEGRATION_DATABASE_REF: isolated.databaseRef,
      AGENT_HOST_INTEGRATION_OPERATION_ID: operationId,
    }
    const entry = { command: process.execPath, args: ['--import', 'tsx', path.resolve('src/server/deployment/__tests__/agentHostAuthorityEntryHarness.ts')] }
    let crossing = 0
    const runWhileExplicitlyClosed = async (input: unknown) => {
      const token = ++crossing; const closedMarker = path.join(normalRoot, `closed-${token}`); const releaseMarker = path.join(normalRoot, `release-${token}`)
      let settled = false
      const pending = runAgentHostRevisionWrapper({ stdin: Readable.from([JSON.stringify(input)]), env: {
        ...env, AGENT_HOST_INTEGRATION_CLOSED_MARKER: closedMarker, AGENT_HOST_INTEGRATION_RELEASE_MARKER: releaseMarker,
      }, entry }).finally(() => { settled = true })
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) { try { await access(closedMarker); break } catch { await new Promise((resolve) => setTimeout(resolve, 20)) } }
      await access(closedMarker); expect(settled).toBe(false)
      const [connections] = await isolated.admin<{ count: string }[]>`SELECT count(*)::text AS count FROM pg_stat_activity WHERE usename = ${isolated.databaseRef} AND datname = ${isolated.databaseRef}`
      expect(connections?.count).toBe('0')
      await writeFile(releaseMarker, 'release', { mode: 0o400, flag: 'wx' })
      return pending
    }
    const apply = { kind: 'apply', plan: { ...state.desired.plan, expectedHostRevision: state.completeTwo.revisionId } }
    const applied = await runWhileExplicitlyClosed(apply)
    expect(applied).toEqual(expect.objectContaining({ exitCode: 0 })); expect(JSON.parse(applied.line)).toMatchObject({ ok: true, result: { kind: 'APPLY', action: 'NOOP' } })

    const check = postgres(isolated.databaseUrl, { max: 1 }); const journal = createAgentHostDestructivePublicationJournalStore(); const checkReserved = await check.reserve()
    try { expect((await journal.readOperation(checkReserved, operationId))?.terminal?.state).toBe('committed') }
    finally { checkReserved.release(); await check.end() }

    const rollback = { kind: 'rollback', hostId: AGENT_HOST_AUTHORITY_TEST_HOST, expectedHostRevision: state.completeTwo.revisionId, targetRevision: state.completeOne.revisionId }
    const rolledBack = await runWhileExplicitlyClosed(rollback)
    expect(rolledBack.exitCode).toBe(0); expect(JSON.parse(rolledBack.line)).toMatchObject({ ok: true, result: { kind: 'ROLLBACK', action: 'CREATE', revisionId: 'r0000000003' } })
    expect(`${applied.line}${rolledBack.line}`).not.toMatch(/postgres|canary|agent-host-proof-authority-|database-url|\/tmp\//)
    expect(await readdir(normalState)).toEqual(['production-marker'])

    const [productionTable] = await isolated.admin<{ present: string | null }[]>`SELECT to_regclass('public.agent_host_destructive_publication_events')::text AS present`
    if (productionTable?.present) {
      const [productionEvent] = await isolated.admin<{ count: string }[]>`SELECT count(*)::text AS count FROM agent_host_destructive_publication_events WHERE operation_id = ${operationId}`
      expect(productionEvent?.count).toBe('0')
    }
    await isolated.admin.end()
  }, 120_000)
})
