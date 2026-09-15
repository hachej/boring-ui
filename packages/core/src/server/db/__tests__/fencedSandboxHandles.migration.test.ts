import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PostgresWorkspaceStore } from '../stores/PostgresWorkspaceStore.js'
import { WorkspaceRuntimeSandboxHandleStore } from '../../runtime/WorkspaceRuntimeSandboxHandleStore.js'
import { createSandboxHandleCipher, type SandboxHandleLease } from '../../runtime/FencedSandboxHandleStore.js'
import { PostgresFencedSandboxHandleStore } from '../../runtime/PostgresFencedSandboxHandleStore.js'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const migrationPath = (name: string) => fileURLToPath(new URL(`../../../../drizzle/${name}`, import.meta.url))
const migration0028 = readFileSync(migrationPath('0028_invite_idempotency_claims.sql'), 'utf8')
const migration0029 = readFileSync(migrationPath('0029_fenced_sandbox_handles.sql'), 'utf8')
const runtimeResourcesDdl = readFileSync(migrationPath('0009_workspace_runtime_resources.sql'), 'utf8')

let client: postgres.Sql

beforeAll(() => {
  client = postgres(TEST_DB_URL, { max: 1 })
})

afterAll(async () => {
  await client.end()
})

describe('0029 fenced sandbox handles migration', () => {
  it('preserves a fenced row across a real pre-0029 persistence-path rollback cohort', async () => {
    expect(migration0029).toContain('CREATE TABLE "fenced_sandbox_handles"')
    expect(migration0029).toContain('CREATE TABLE "fenced_sandbox_handle_audit"')
    expect(migration0029).not.toMatch(/CREATE TABLE IF NOT EXISTS/i)

    const schema = `fenced_migration_${randomUUID().replaceAll('-', '')}`
    const workspaceId = randomUUID()
    await client.unsafe(`CREATE SCHEMA "${schema}"`)
    try {
      await client.unsafe(`SET search_path TO "${schema}"`)
      await client.unsafe(`
        CREATE TABLE workspaces (
          id uuid PRIMARY KEY,
          app_id text NOT NULL,
          workspace_type_id text NOT NULL DEFAULT 'default',
          name text NOT NULL,
          created_by uuid NOT NULL,
          created_at timestamp NOT NULL DEFAULT now(),
          deleted_at timestamp,
          is_default boolean NOT NULL DEFAULT false,
          managed_by text,
          default_agent_type_id text NOT NULL DEFAULT 'default'
        );
        CREATE TABLE idempotency_keys (
          key text PRIMARY KEY,
          scope text NOT NULL,
          response_status integer NOT NULL,
          response_body jsonb NOT NULL,
          created_at timestamp NOT NULL DEFAULT now()
        );
      `)
      await client.unsafe(runtimeResourcesDdl)
      // 0028 is the actual pre-0029 base revision used by the rollback cohort.
      await client.unsafe(migration0028)
      await client.unsafe(migration0029)
      await client`INSERT INTO workspaces (id, app_id, name, created_by) VALUES (${workspaceId}, 'app', 'Rollback proof', ${randomUUID()})`

      const db = drizzle(client)
      // This persistence path is byte-for-byte unchanged from the pre-0029 app revision.
      const priorPath = new WorkspaceRuntimeSandboxHandleStore(new PostgresWorkspaceStore(db), 'vercel')
      await priorPath.put({
        workspaceId,
        sandboxId: 'legacy-before-rollback',
        createdAt: '2026-09-14T00:00:00.000Z',
        lastUsedAt: '2026-09-14T00:00:00.000Z',
      })

      const key = { hostScope: schema, workspaceId, provider: 'vercel', mode: 'ephemeral' }
      const cipher = createSandboxHandleCipher(randomBytes(32))
      const deployed = new PostgresFencedSandboxHandleStore(db, cipher)
      const first = await deployed.claim({ key, leaseOwner: 'new-deployment', leaseForMs: 10_000 })
      if (!first || first.status !== 'claimed') throw new Error('expected initial fenced claim')
      const attempt = await deployed.beginCreate({ key, generation: first.generation, leaseToken: first.leaseToken })
      expect(attempt?.status).toBe('started')
      expect(await deployed.update(
        { key, generation: first.generation, leaseToken: first.leaseToken },
        new TextEncoder().encode('fenced-handle'),
        1,
      )).toBe(true)
      expect(await deployed.release({ key, generation: first.generation, leaseToken: first.leaseToken })).toBe(true)

      const beforeRollback = await client<{ generation: number; encrypted_handle: Uint8Array; updated_at: Date }[]>`
        SELECT generation, encrypted_handle, updated_at FROM fenced_sandbox_handles
        WHERE host_scope = ${key.hostScope} AND workspace_id = ${key.workspaceId}
          AND provider = ${key.provider} AND mode = ${key.mode}
      `

      // A rollback cohort uses only its released persistence API and cannot touch 0029 rows.
      expect((await priorPath.get(workspaceId))?.sandboxId).toBe('legacy-before-rollback')
      await priorPath.put({
        workspaceId,
        sandboxId: 'legacy-during-rollback',
        createdAt: '2026-09-14T00:00:00.000Z',
        lastUsedAt: '2026-09-14T00:01:00.000Z',
      })
      const afterRollback = await client<{ generation: number; encrypted_handle: Uint8Array; updated_at: Date }[]>`
        SELECT generation, encrypted_handle, updated_at FROM fenced_sandbox_handles
        WHERE host_scope = ${key.hostScope} AND workspace_id = ${key.workspaceId}
          AND provider = ${key.provider} AND mode = ${key.mode}
      `
      expect(afterRollback).toEqual(beforeRollback)

      const restored = new PostgresFencedSandboxHandleStore(db, cipher)
      const reclaimed = await restored.claim({ key, leaseOwner: 'restored-deployment', leaseForMs: 10_000 })
      if (!reclaimed || reclaimed.status !== 'claimed') throw new Error('expected restored fenced claim')
      expect(reclaimed.generation).toBe((first as SandboxHandleLease).generation + 1)
      expect(new TextDecoder().decode(reclaimed.handle!)).toBe('fenced-handle')

      await expect(client.unsafe(migration0029)).rejects.toMatchObject({ code: '42P07' })
    } finally {
      await client.unsafe('SET search_path TO public')
      await client.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
    }
  })
})
