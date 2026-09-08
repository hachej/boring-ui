import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { createDrizzleIdempotencyStore } from '../idempotency'
import { runMigrations } from '../../db/migrate'

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const scope = `invite-idempotency-test:${randomUUID()}`
let client: postgres.Sql
let otherClient: postgres.Sql
let store: ReturnType<typeof createDrizzleIdempotencyStore>
let otherStore: ReturnType<typeof createDrizzleIdempotencyStore>

beforeAll(async () => {
  await runMigrations({ databaseUrl })
  // Separate pools reproduce separate app processes competing on the same key.
  client = postgres(databaseUrl, { max: 2 })
  otherClient = postgres(databaseUrl, { max: 2 })
  store = createDrizzleIdempotencyStore(drizzle(client))
  otherStore = createDrizzleIdempotencyStore(drizzle(otherClient))
})

afterAll(async () => {
  if (client) {
    await client`DELETE FROM idempotency_keys WHERE scope = ${scope}`
    await client.end()
  }
  await otherClient?.end()
})

describe('Postgres idempotency claims', () => {
  it('upgrades the previous schema without discarding cached responses', async () => {
    const migration = await readFile(new URL('../../../../drizzle/0028_invite_idempotency_claims.sql', import.meta.url), 'utf8')
    await client.begin(async (transaction) => {
      // Temporary tables shadow public tables only on this connection. This
      // checks the real upgrade while leaving the shared test database intact.
      await transaction`CREATE TEMP TABLE idempotency_keys (
        key text PRIMARY KEY, scope text NOT NULL,
        response_status integer NOT NULL, response_body jsonb NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      ) ON COMMIT DROP`
      await transaction`INSERT INTO idempotency_keys (key, scope, response_status, response_body)
        VALUES ('old-key', 'invites', 201, '{"invite":{"id":"before-upgrade"}}'::jsonb)`
      for (const statement of migration.split('--> statement-breakpoint')) {
        await transaction.unsafe(statement)
      }
      const [legacy] = await transaction`SELECT * FROM idempotency_keys WHERE key = 'old-key'`
      expect(legacy).toMatchObject({ response_status: 201,
        response_body: { invite: { id: 'before-upgrade' } }, request_hash: null })
      await transaction`INSERT INTO idempotency_keys (key, scope, request_hash)
        VALUES ('new-key', 'scoped-invites', 'digest')`
      const [pending] = await transaction`SELECT * FROM idempotency_keys WHERE key = 'new-key'`
      expect(pending).toMatchObject({ request_hash: 'digest', response_status: null, response_body: null })
    })
  })

  it('admits one owner across connections and replays only the matching request', async () => {
    const key = `${scope}:concurrent`
    const claims = await Promise.all([
      store.claim(key, scope, 'digest-a'),
      otherStore.claim(key, scope, 'digest-a'),
    ])
    expect(claims.map((claim) => claim.status).sort()).toEqual(['claimed', 'pending'])
    expect(await store.find(key)).toBeNull()
    expect(await otherStore.claim(key, scope, 'digest-b')).toEqual({ status: 'conflict' })
    await store.set(key, scope, 201, { invite: { id: 'created-once' } })
    expect(await otherStore.claim(key, scope, 'digest-a')).toEqual({
      status: 'replay', entry: { responseStatus: 201, responseBody: { invite: { id: 'created-once' } } },
    })
    expect(await otherStore.claim(key, scope, 'digest-b')).toEqual({ status: 'conflict' })
    // A repeated terminal write must not replace the outcome already recorded.
    await otherStore.set(key, scope, 500, { error: 'late failure' })
    expect(await store.find(key)).toEqual({ responseStatus: 201, responseBody: { invite: { id: 'created-once' } } })
  })

  it('retains unresolved claims and starts the replay TTL when the response completes', async () => {
    const key = `${scope}:ttl`
    expect(await store.claim(key, scope, 'digest')).toEqual({ status: 'claimed' })
    await client`UPDATE idempotency_keys SET created_at = now() - interval '25 hours' WHERE key = ${key}`
    await otherStore.sweep()
    expect(await otherStore.claim(key, scope, 'digest')).toEqual({ status: 'pending' })
    await store.set(key, scope, 201, { ok: true })
    await otherStore.sweep()
    expect(await otherStore.claim(key, scope, 'digest')).toEqual({
      status: 'replay', entry: { responseStatus: 201, responseBody: { ok: true } },
    })
    await client`UPDATE idempotency_keys SET created_at = now() - interval '25 hours' WHERE key = ${key}`
    await otherStore.sweep()
    expect(await otherStore.claim(key, scope, 'digest')).toEqual({ status: 'claimed' })
  })

  it('preserves legacy completed entries without trusting them as matching claims', async () => {
    const key = `${scope}:legacy`
    await client`INSERT INTO idempotency_keys (key, scope, response_status, response_body)
      VALUES (${key}, ${scope}, 201, '{"legacy":true}'::jsonb)`
    expect(await store.find(key)).toEqual({ responseStatus: 201, responseBody: { legacy: true } })
    expect(await store.claim(key, scope, 'digest')).toEqual({ status: 'conflict' })
  })
})
