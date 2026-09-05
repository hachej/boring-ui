import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../../../shared/credentials'
import type { CredentialFieldId, ProviderId } from '../../../../shared/credentials'
import { actorCredentialProviderIdV1 } from '../../vaultCredentialStore'
import {
  createInMemoryCredentialVersionAnchorV1,
  createLocalFileCredentialVersionAnchorV1,
  createLocalKekWorkspaceKekProviderV1,
  createPostgresCredentialVaultPersistenceV1,
  createVaultCredentialStoreBackendV1,
  decryptCredentialFieldV1,
  initializeLocalFileCredentialVersionAnchorV1,
  runCredentialVaultPostgresMigrationsV1,
} from '..'
import type { CredentialVaultPersistenceV1 } from '../persistence'
import { runCredentialVaultPersistenceConformanceV1 } from './persistenceConformance'
import { runVaultCredentialStoreConformanceV1 } from './vaultBackendConformance'

const TEST_DB_URL = process.env.DATABASE_URL
  ?? 'postgres://ubuntu:test@localhost:5432/boring_ui_test'
const schemaName = `vault_s1_${randomUUID().replaceAll('-', '')}`
const adminSql = postgres(TEST_DB_URL, { max: 1 })
const sql = postgres(TEST_DB_URL, {
  max: 5,
  connection: { search_path: schemaName },
})

beforeAll(async () => {
  await adminSql.unsafe(`CREATE SCHEMA ${schemaName}`)
  await runCredentialVaultPostgresMigrationsV1(sql)
})

afterAll(async () => {
  await sql.end()
  await adminSql.unsafe(`DROP SCHEMA ${schemaName} CASCADE`)
  await adminSql.end()
})

runCredentialVaultPersistenceConformanceV1(
  'postgres',
  async () => createPostgresCredentialVaultPersistenceV1(sql),
)
runVaultCredentialStoreConformanceV1(
  'postgres',
  async () => createPostgresCredentialVaultPersistenceV1(sql),
)

describe('Postgres credential workspace lock lifecycle', () => {
  async function holdWorkspaceLock(workspaceId: string) {
    const blocker = await adminSql.reserve()
    const lockKey = JSON.stringify(['credential-workspace', workspaceId])
    await blocker`SELECT pg_advisory_lock(hashtextextended(${lockKey}, 0))`
    return async () => {
      await blocker`SELECT pg_advisory_unlock(hashtextextended(${lockKey}, 0))`
      blocker.release()
    }
  }

  test('times out with a stable retryable error and releases its reserved connection', async () => {
    const workspaceId = `lock-timeout-${randomUUID()}`
    const releaseBlocker = await holdWorkspaceLock(workspaceId)
    const persistence = createPostgresCredentialVaultPersistenceV1(sql, {
      lockAcquireTimeoutMs: 40,
      lockPollIntervalMs: 5,
    })
    await expect(persistence.withWorkspaceLock(workspaceId, async () => undefined))
      .rejects.toMatchObject({
        code: CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
        retryable: true,
        message: 'Credential workspace lock timed out',
      })
    await releaseBlocker()

    // With repeated failure on a max-bounded pool, this would eventually hang
    // if timed-out reserved connections were left pinned.
    for (let index = 0; index < 8; index += 1) {
      await expect(persistence.withWorkspaceLock(workspaceId, async () => index))
        .resolves.toBe(index)
    }
  })

  test('bounds pool reservation and releases a late reservation', async () => {
    const workspaceId = `lock-pool-${randomUUID()}`
    const oneConnectionSql = postgres(TEST_DB_URL, {
      max: 1,
      connection: { search_path: schemaName },
    })
    const blocker = await oneConnectionSql.reserve()
    let blockerReleased = false
    const persistence = createPostgresCredentialVaultPersistenceV1(oneConnectionSql, {
      lockAcquireTimeoutMs: 40,
      lockPollIntervalMs: 5,
    })
    const startedAt = Date.now()
    try {
      await expect(persistence.withWorkspaceLock(workspaceId, async () => undefined))
        .rejects.toMatchObject({
          code: CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
          retryable: true,
          message: 'Credential workspace lock timed out',
        })
      expect(Date.now() - startedAt).toBeLessThan(500)
      blocker.release()
      blockerReleased = true
      await new Promise((resolve) => setTimeout(resolve, 20))
      await expect(persistence.withWorkspaceLock(workspaceId, async () => 'reused', {
        timeoutMs: 1_000,
      })).resolves.toBe('reused')
    } finally {
      if (!blockerReleased) blocker.release()
      await oneConnectionSql.end({ timeout: 1 })
    }
  })

  test('honors an absolute acquisition deadline', async () => {
    const workspaceId = `lock-deadline-${randomUUID()}`
    const releaseBlocker = await holdWorkspaceLock(workspaceId)
    const persistence = createPostgresCredentialVaultPersistenceV1(sql, {
      lockAcquireTimeoutMs: 1_000,
      lockPollIntervalMs: 5,
    })
    await expect(persistence.withWorkspaceLock(workspaceId, async () => undefined, {
      deadlineMs: Date.now() + 30,
    })).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
      retryable: true,
      message: 'Credential workspace lock timed out',
    })
    await releaseBlocker()
  })

  test('cancels lock waiting without running the mutation', async () => {
    const workspaceId = `lock-cancel-${randomUUID()}`
    const releaseBlocker = await holdWorkspaceLock(workspaceId)
    const controller = new AbortController()
    let mutated = false
    const waiting = createPostgresCredentialVaultPersistenceV1(sql, {
      lockAcquireTimeoutMs: 1_000,
      lockPollIntervalMs: 100,
    }).withWorkspaceLock(workspaceId, async () => { mutated = true }, {
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 20)
    await expect(waiting).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
      retryable: true,
      message: 'Credential workspace lock cancelled',
    })
    expect(mutated).toBe(false)
    await releaseBlocker()
  })

  test('waits successfully and preserves full mutation serialization', async () => {
    const workspaceId = `lock-wait-${randomUUID()}`
    const releaseBlocker = await holdWorkspaceLock(workspaceId)
    let mutated = false
    const waiting = createPostgresCredentialVaultPersistenceV1(sql, {
      lockAcquireTimeoutMs: 1_000,
      lockPollIntervalMs: 5,
    }).withWorkspaceLock(workspaceId, async () => {
      mutated = true
      return 'locked'
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(mutated).toBe(false)
    await releaseBlocker()
    await expect(waiting).resolves.toBe('locked')
    expect(mutated).toBe(true)
  })

  test('evicts a connection when a lock query resolves after its deadline', async () => {
    const workspaceId = `lock-late-query-${randomUUID()}`
    let delayed = false
    const delayedSql = new Proxy(sql, {
      get(target, property, receiver) {
        if (property !== 'reserve') return Reflect.get(target, property, receiver)
        return async () => {
          const reserved = await target.reserve()
          return new Proxy(reserved, {
            apply(queryTarget, thisArg, args) {
              const query = Reflect.apply(queryTarget, thisArg, args)
              const text = Array.isArray(args[0]?.raw) ? args[0].raw.join('') : ''
              if (delayed || !text.includes('pg_try_advisory_lock')) return query
              delayed = true
              const pending = new Promise((resolve, reject) => {
                void Promise.resolve(query).then(
                  (result) => setTimeout(() => resolve(result), 80),
                  reject,
                )
              })
              return Object.assign(pending, { cancel: () => query.cancel() })
            },
          })
        }
      },
    }) as typeof sql
    const persistence = createPostgresCredentialVaultPersistenceV1(delayedSql, {
      lockAcquireTimeoutMs: 30,
      lockPollIntervalMs: 5,
    })
    await expect(persistence.withWorkspaceLock(workspaceId, async () => {
      throw new Error('mutation must not run')
    })).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
      retryable: true,
    })
    await expect(createPostgresCredentialVaultPersistenceV1(sql)
      .withWorkspaceLock(workspaceId, async () => 'not-left-locked'))
      .resolves.toBe('not-left-locked')
  })

  test('evicts a reserved connection when unlock cannot be confirmed', async () => {
    const workspaceId = `lock-destroy-${randomUUID()}`
    const evictionSql = postgres(TEST_DB_URL, {
      max: 2,
      connection: { search_path: schemaName },
    })
    const persistence = createPostgresCredentialVaultPersistenceV1(evictionSql, {
      lockAcquireTimeoutMs: 1_000,
      lockPollIntervalMs: 5,
    })
    try {
      await expect(persistence.withWorkspaceLock(workspaceId, async () => {
        const lockKey = JSON.stringify(['credential-workspace', workspaceId])
        const locks = await adminSql<{ pid: number }[]>`
          SELECT pid FROM pg_locks
          WHERE locktype = 'advisory' AND granted
            AND classid = (((hashtextextended(${lockKey}, 0) >> 32) & 4294967295)::oid)
            AND objid = ((hashtextextended(${lockKey}, 0) & 4294967295)::oid)
        `
        expect(locks).toHaveLength(1)
        await adminSql`SELECT pg_terminate_backend(${locks[0]!.pid})`
      })).rejects.toMatchObject({
        code: CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
        retryable: true,
        message: 'Credential workspace lock could not be released',
      })

      // The dead reserved connection is replaced rather than returned poisoned.
      await expect(persistence.withWorkspaceLock(workspaceId, async () => 'replacement'))
        .resolves.toBe('replacement')
    } finally {
      await evictionSql.end({ timeout: 1 })
    }
  })

  test('bounds a stalled unlock and evicts through an out-of-band connection', async () => {
    const workspaceId = `lock-stalled-unlock-${randomUUID()}`
    let stalled = false
    const stalledSql = new Proxy(sql, {
      get(target, property, receiver) {
        if (property !== 'reserve') return Reflect.get(target, property, receiver)
        return async () => {
          const reserved = await target.reserve()
          return new Proxy(reserved, {
            apply(queryTarget, thisArg, args) {
              const text = Array.isArray(args[0]?.raw) ? args[0].raw.join('') : ''
              if (!stalled && text.includes('pg_advisory_unlock')) {
                stalled = true
                return Object.assign(new Promise(() => undefined), { cancel() {} })
              }
              return Reflect.apply(queryTarget, thisArg, args)
            },
          })
        }
      },
    }) as typeof sql
    const persistence = createPostgresCredentialVaultPersistenceV1(stalledSql, {
      lockAcquireTimeoutMs: 1_000,
      lockReleaseTimeoutMs: 30,
    })
    const startedAt = Date.now()
    await expect(persistence.withWorkspaceLock(workspaceId, async () => 'committed'))
      .rejects.toMatchObject({
        code: CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
        retryable: true,
        message: 'Credential workspace lock could not be released',
      })
    expect(Date.now() - startedAt).toBeLessThan(500)
    await expect(createPostgresCredentialVaultPersistenceV1(sql)
      .withWorkspaceLock(workspaceId, async () => 'replacement'))
      .resolves.toBe('replacement')
  })
})

describe('Postgres credential rollback protection', () => {
  test('migration is idempotent and preserves existing rows as explicit workspace custody', async () => {
    await runCredentialVaultPostgresMigrationsV1(sql)
    const workspaceId = `legacy-${randomUUID()}`
    await sql`
      INSERT INTO workspace_provider_credentials (
        workspace_id, provider_id, credential_id, display_label, credential_type,
        state, credential_version, dek_generation, material_kind
      ) VALUES (${workspaceId}, 'legacy-provider', 'legacy-id', 'Legacy', 'api-key',
        'intentionally_absent', 1, 1, 'none')
    `
    const rows = await sql<{ credential_subject_kind: string; credential_subject_id: string }[]>`
      SELECT credential_subject_kind, credential_subject_id
      FROM workspace_provider_credentials WHERE workspace_id = ${workspaceId}
    `
    expect(rows).toEqual([{ credential_subject_kind: 'workspace', credential_subject_id: '' }])
  })

  test('persists personal credential rows with immutable actor columns', async () => {
    const workspaceId = `actor-${randomUUID()}`
    const providerId = actorCredentialProviderIdV1('user-a', 'openai-codex')
    const persistence = createPostgresCredentialVaultPersistenceV1(sql)
    await persistence.putCredentialRecord(workspaceId, providerId, {
      credentialId: 'actor-credential', credentialVersion: 1, dekGeneration: 1, materialKind: 'none',
    })
    const rows = await sql<{ credential_subject_kind: string; credential_subject_id: string; provider_id: string }[]>`
      SELECT credential_subject_kind, credential_subject_id, provider_id
      FROM workspace_provider_credentials WHERE workspace_id = ${workspaceId}
    `
    expect(rows).toEqual([{
      credential_subject_kind: 'user', credential_subject_id: 'user-a', provider_id: providerId,
    }])
  })

  test('fails closed when current material state is changed without a version bump', async () => {
    const workspaceId = `ws-${randomUUID()}`
    const providerId = 'material-state-provider' as ProviderId
    const fieldId = 'api-key' as CredentialFieldId
    const backend = createVaultCredentialStoreBackendV1({
      persistence: createPostgresCredentialVaultPersistenceV1(sql),
      versionAnchor: createInMemoryCredentialVersionAnchorV1(),
      kmsBackend: createLocalKekWorkspaceKekProviderV1({
        keyRef: 'material-state-test',
        keyVersion: 1,
        loadKek: async () => new Uint8Array(32).fill(0xa5),
      }),
    })
    await backend.writeCredentialFields({
      workspaceId,
      providerId,
      fields: new Map([[fieldId, new TextEncoder().encode('secret')]]),
    })
    await sql`
      UPDATE workspace_provider_credentials
      SET material_kind = 'none'
      WHERE workspace_id = ${workspaceId} AND provider_id = ${providerId}
    `

    await expect(backend.read(workspaceId, providerId, []))
      .rejects.toMatchObject({
        code: CREDENTIAL_ERROR_CODES.UNREADABLE,
      } satisfies Partial<CredentialResolutionError>)
  })

  test('fails closed after a wholesale old-version database snapshot replay', async () => {
    const workspaceId = `ws-${randomUUID()}`
    const providerId = 'snapshot-provider' as ProviderId
    const fieldId = 'api-key' as CredentialFieldId
    const persistence = createPostgresCredentialVaultPersistenceV1(sql)
    const anchorFilePath = join(
      await mkdtemp(join(tmpdir(), 'boring-postgres-anchor-')),
      'credential-anchor',
    )
    const loadKek = async () => new Uint8Array(32).fill(0xa5)
    await initializeLocalFileCredentialVersionAnchorV1({
      anchorFilePath,
      loadKek,
    })
    const backend = createVaultCredentialStoreBackendV1({
      persistence,
      versionAnchor: createLocalFileCredentialVersionAnchorV1({
        anchorFilePath,
        loadKek,
      }),
      kmsBackend: createLocalKekWorkspaceKekProviderV1({
        keyRef: 'snapshot-test',
        keyVersion: 1,
        loadKek,
      }),
    })

    await backend.writeCredentialFields({
      workspaceId,
      providerId,
      fields: new Map([[fieldId, new TextEncoder().encode('old-secret')]]),
    })
    const recordSnapshot = (await sql`
      SELECT * FROM workspace_provider_credentials
      WHERE workspace_id = ${workspaceId} AND provider_id = ${providerId}
    `)[0]!
    const fieldSnapshot = (await sql`
      SELECT * FROM workspace_provider_credential_fields
      WHERE workspace_id = ${workspaceId} AND provider_id = ${providerId}
        AND credential_version = 1
    `)[0]!

    await backend.writeCredentialFields({
      workspaceId,
      providerId,
      fields: new Map([[fieldId, new TextEncoder().encode('new-secret')]]),
    })
    const tombstone = (await sql<{
      ciphertext: Uint8Array | null
      deleted_at: Date | null
      deletion_reason: string | null
    }[]>`
      SELECT ciphertext, deleted_at, deletion_reason
      FROM workspace_provider_credential_fields
      WHERE workspace_id = ${workspaceId} AND provider_id = ${providerId}
        AND credential_version = 1 AND field_id = ${fieldId}
    `)[0]!
    expect(tombstone.ciphertext).toBeNull()
    expect(tombstone.deleted_at).toBeInstanceOf(Date)
    expect(tombstone.deletion_reason).toBe('superseded-version')

    await sql`
      UPDATE workspace_provider_credentials SET
        credential_id = ${recordSnapshot.credential_id},
        credential_version = ${recordSnapshot.credential_version},
        dek_generation = ${recordSnapshot.dek_generation},
        material_kind = ${recordSnapshot.material_kind}
      WHERE workspace_id = ${workspaceId} AND provider_id = ${providerId}
    `
    await sql`
      UPDATE workspace_provider_credential_fields SET
        envelope_version = ${fieldSnapshot.envelope_version},
        ciphertext = ${fieldSnapshot.ciphertext},
        nonce = ${fieldSnapshot.nonce},
        auth_tag = ${fieldSnapshot.auth_tag},
        aad_context = ${fieldSnapshot.aad_context},
        dek_generation = ${fieldSnapshot.dek_generation},
        deleted_at = NULL,
        deletion_reason = NULL
      WHERE workspace_id = ${workspaceId} AND provider_id = ${providerId}
        AND credential_version = 1 AND field_id = ${fieldId}
    `

    await expect(backend.read(workspaceId, providerId, [fieldId]))
      .rejects.toMatchObject({
        code: CREDENTIAL_ERROR_CODES.UNREADABLE,
      } satisfies Partial<CredentialResolutionError>)
  })

  test('recovers the same durable DEK rotation after every database/anchor boundary', async () => {
    const boundaries = [
      'intent-marker',
      'target-key',
      'record-migration',
      'verified-marker',
      'anchor-lock-recovery',
      'anchor-advance',
      'anchor-advanced-marker',
      'atomic-finalize',
    ] as const

    for (const boundary of boundaries) {
      const workspaceId = `rotation-${boundary}-${randomUUID()}`
      const providerId = 'rotation-provider' as ProviderId
      const fieldId = 'api-key' as CredentialFieldId
      const operationId = `operation-${boundary}`
      const anchorFilePath = join(
        await mkdtemp(join(tmpdir(), 'boring-postgres-rotation-anchor-')),
        'credential-anchor',
      )
      const loadKek = async () => new Uint8Array(32).fill(0xa5)
      await initializeLocalFileCredentialVersionAnchorV1({ anchorFilePath, loadKek })
      const kmsBackend = createLocalKekWorkspaceKekProviderV1({
        keyRef: 'rotation-recovery-test',
        keyVersion: 1,
        loadKek,
      })
      const durable = createPostgresCredentialVaultPersistenceV1(sql)
      const anchor = createLocalFileCredentialVersionAnchorV1({ anchorFilePath, loadKek })
      const initial = createVaultCredentialStoreBackendV1({
        persistence: durable,
        versionAnchor: anchor,
        kmsBackend,
      })
      await initial.writeCredentialFields({
        workspaceId,
        providerId,
        fields: new Map([[fieldId, new TextEncoder().encode(`secret-${boundary}`)]]),
      })
      const oldWrapped = await durable.getWrappedDek(workspaceId, 1)
      if (!oldWrapped) throw new Error('missing source DEK')
      const oldDek = await kmsBackend.unwrapDataKey(
        { workspaceId, dekGeneration: 1, requestId: `capture-${boundary}` },
        oldWrapped,
      )

      let injected = false
      const wrapPersistence = (
        target: CredentialVaultPersistenceV1,
      ): CredentialVaultPersistenceV1 => new Proxy(target, {
        get(current, property) {
          if (property === 'withWorkspaceLock') {
            return async <T>(lockedWorkspaceId: string, mutate: (locked: CredentialVaultPersistenceV1) => Promise<T>) =>
              current.withWorkspaceLock(lockedWorkspaceId, async (locked) => mutate(wrapPersistence(locked)))
          }
          const value = current[property as keyof CredentialVaultPersistenceV1]
          if (typeof value !== 'function') return value
          return async (...args: unknown[]) => {
            const result = await (value as (...callArgs: unknown[]) => Promise<unknown>)
              .apply(current, args)
            const state = args[1] as { phase?: string } | undefined
            const shouldCrash = !injected && (
              (boundary === 'intent-marker' && property === 'putDekRotationState' && state?.phase === 'reencrypting')
              || (boundary === 'target-key' && property === 'putWrappedDek' && args[1] === 2)
              || (boundary === 'record-migration' && property === 'commitDekRotationRecord')
              || (boundary === 'verified-marker' && property === 'putDekRotationState' && state?.phase === 'verified')
              || (boundary === 'anchor-advanced-marker' && property === 'putDekRotationState' && state?.phase === 'anchor-advanced')
              || (boundary === 'atomic-finalize' && property === 'finalizeDekRotation')
            )
            if (shouldCrash) {
              injected = true
              throw new Error(`simulated crash after ${boundary}`)
            }
            return result
          }
        },
      })
      const faultAnchor = boundary === 'anchor-lock-recovery' || boundary === 'anchor-advance'
        ? {
            ...anchor,
            async withDekGenerationMutation<T>(
              requestedWorkspaceId: string,
              mutate: Parameters<typeof anchor.withDekGenerationMutation<T>>[1],
            ): Promise<T> {
              if (!injected && boundary === 'anchor-lock-recovery') {
                injected = true
                await mkdir(`${anchorFilePath}.lock`, { mode: 0o700 })
                const stale = new Date(Date.now() - 60_000)
                await utimes(`${anchorFilePath}.lock`, stale, stale)
                throw new Error('simulated crash after anchor-lock-recovery')
              }
              const result = await anchor.withDekGenerationMutation(requestedWorkspaceId, mutate)
              if (!injected) {
                injected = true
                throw new Error('simulated crash after anchor-advance')
              }
              return result
            },
          }
        : anchor
      const interrupted = createVaultCredentialStoreBackendV1({
        persistence: wrapPersistence(durable),
        versionAnchor: faultAnchor,
        kmsBackend,
      })
      await expect(interrupted.rotateWorkspaceDek(workspaceId, operationId))
        .rejects.toThrow(`simulated crash after ${boundary}`)
      if (boundary === 'intent-marker') {
        await expect(initial.writeCredentialFields({
          workspaceId,
          providerId,
          fields: new Map([[fieldId, new TextEncoder().encode('must-wait-for-rotation')]]),
        })).rejects.toMatchObject({
          code: CREDENTIAL_ERROR_CODES.BACKEND_UNAVAILABLE,
          retryable: true,
        })
      }

      // A new backend/anchor instance models process restart. The same operation
      // id resumes N→N+1 and the durable receipt makes even post-finalize retry idempotent.
      const restarted = createVaultCredentialStoreBackendV1({
        persistence: createPostgresCredentialVaultPersistenceV1(sql),
        versionAnchor: createLocalFileCredentialVersionAnchorV1({ anchorFilePath, loadKek }),
        kmsBackend,
      })
      await expect(restarted.rotateWorkspaceDek(workspaceId, operationId)).resolves.toBe(2)
      await expect(restarted.rotateWorkspaceDek(workspaceId, operationId)).resolves.toBe(2)
      expect(await durable.getDekRotationState(workspaceId)).toBeUndefined()
      expect(await durable.getDekRotationReceipt(workspaceId, operationId)).toMatchObject({
        sourceGeneration: 1,
        targetGeneration: 2,
      })
      expect(await durable.getWrappedDek(workspaceId, 1)).toBeUndefined()
      expect(await durable.getWrappedDek(workspaceId, 3)).toBeUndefined()
      expect(await anchor.read(workspaceId)).toMatchObject({
        dekGeneration: 2,
        dekRotationReceipts: { [operationId]: 2 },
      })
      if (boundary === 'atomic-finalize') {
        await sql`
          INSERT INTO workspace_credential_dek_rotation_receipts (
            workspace_id, operation_id, source_generation, target_generation
          ) VALUES (${workspaceId}, 'forged-operation', 1, 2)
        `
        await expect(restarted.rotateWorkspaceDek(workspaceId, 'forged-operation'))
          .rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.UNREADABLE })
        await sql`
          DELETE FROM workspace_credential_dek_rotation_receipts
          WHERE workspace_id = ${workspaceId} AND operation_id = ${operationId}
        `
        await expect(restarted.rotateWorkspaceDek(workspaceId, operationId))
          .rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.UNREADABLE })
      }
      const resolved = await restarted.read(workspaceId, providerId, [fieldId])
      if (resolved.kind !== 'field-set') throw new Error('expected rotated field set')
      expect(new TextDecoder().decode(resolved.fields.get(fieldId))).toBe(`secret-${boundary}`)
      const record = await durable.getCredentialRecord(workspaceId, providerId)
      const envelope = await durable.getField({
        workspaceId,
        providerId,
        credentialVersion: record!.credentialVersion,
        fieldId,
      })
      expect(() => decryptCredentialFieldV1({
        plaintextDek: oldDek,
        envelope: envelope!,
        aadContext: {
          workspaceId,
          credentialId: record!.credentialId,
          providerId,
          fieldId,
          credentialVersion: record!.credentialVersion,
          dekGeneration: 2,
        },
      })).toThrow(CredentialResolutionError)
      oldDek.fill(0)
    }
  })

  test('does not trust a database-forged verified rotation marker', async () => {
    const workspaceId = `rotation-forged-${randomUUID()}`
    const providerId = 'rotation-forged-provider' as ProviderId
    const fieldId = 'api-key' as CredentialFieldId
    const persistence = createPostgresCredentialVaultPersistenceV1(sql)
    const anchor = createInMemoryCredentialVersionAnchorV1()
    const kmsBackend = createLocalKekWorkspaceKekProviderV1({
      keyRef: 'rotation-forged-test',
      keyVersion: 1,
      loadKek: async () => new Uint8Array(32).fill(0xa5),
    })
    const vault = createVaultCredentialStoreBackendV1({ persistence, versionAnchor: anchor, kmsBackend })
    await vault.writeCredentialFields({
      workspaceId,
      providerId,
      fields: new Map([[fieldId, new TextEncoder().encode('still-generation-one')]]),
    })
    const target = await kmsBackend.generateDataKey({
      workspaceId,
      dekGeneration: 2,
      requestId: 'forged-target',
    })
    try {
      await persistence.putWrappedDek(workspaceId, 2, target.wrappedDek)
    } finally {
      target.plaintextDek.fill(0)
    }
    await persistence.putDekRotationState(workspaceId, {
      operationId: 'forged-verified-operation',
      sourceGeneration: 1,
      targetGeneration: 2,
      phase: 'verified',
    })
    await sql`
      DELETE FROM workspace_provider_credentials
      WHERE workspace_id = ${workspaceId} AND provider_id = ${providerId}
    `

    await expect(vault.rotateWorkspaceDek(workspaceId, 'forged-verified-operation'))
      .rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.UNREADABLE })
    await persistence.putDekRotationState(workspaceId, {
      operationId: 'forged-verified-operation',
      sourceGeneration: 1,
      targetGeneration: 2,
      phase: 'anchor-advanced',
    })
    await expect(vault.rotateWorkspaceDek(workspaceId, 'forged-verified-operation'))
      .rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.UNREADABLE })
    expect(await anchor.read(workspaceId)).toMatchObject({ dekGeneration: 1 })
    expect(await persistence.getWrappedDek(workspaceId, 1)).toBeDefined()
  })

  test('rejects a complete pre-shred Postgres snapshot after restart', async () => {
    const workspaceId = `shred-${randomUUID()}`
    const providerId = 'shred-snapshot-provider' as ProviderId
    const fieldId = 'api-key' as CredentialFieldId
    const anchorFilePath = join(
      await mkdtemp(join(tmpdir(), 'boring-postgres-shred-anchor-')),
      'credential-anchor',
    )
    const loadKek = async () => new Uint8Array(32).fill(0xa5)
    await initializeLocalFileCredentialVersionAnchorV1({ anchorFilePath, loadKek })
    const createBackend = () => createVaultCredentialStoreBackendV1({
      persistence: createPostgresCredentialVaultPersistenceV1(sql),
      versionAnchor: createLocalFileCredentialVersionAnchorV1({ anchorFilePath, loadKek }),
      kmsBackend: createLocalKekWorkspaceKekProviderV1({
        keyRef: 'shred-snapshot-test',
        keyVersion: 1,
        loadKek,
      }),
    })
    const backend = createBackend()
    await backend.writeCredentialFields({
      workspaceId,
      providerId,
      fields: new Map([[fieldId, new TextEncoder().encode('pre-shred-secret')]]),
    })

    const keySnapshot = (await sql`
      SELECT * FROM workspace_credential_keys WHERE workspace_id = ${workspaceId}
    `)[0]!
    const fieldSnapshot = (await sql`
      SELECT * FROM workspace_provider_credential_fields
      WHERE workspace_id = ${workspaceId} AND provider_id = ${providerId}
    `)[0]!

    await backend.cryptoShredWorkspace(workspaceId)
    await backend.cryptoShredWorkspace(workspaceId)
    await expect(backend.read(workspaceId, providerId, [fieldId]))
      .rejects.toMatchObject({
        code: CREDENTIAL_ERROR_CODES.UNREADABLE,
      } satisfies Partial<CredentialResolutionError>)

    // Simulate restoring a complete pre-shred database snapshot: the live
    // wrapped DEK and envelope return and the database-local shred row vanishes.
    await sql`
      INSERT INTO workspace_credential_keys (
        workspace_id, dek_generation, kms_provider_id, key_ref, key_version,
        payload_format, payload_format_id, ciphertext, nonce, auth_tag,
        aad_context, opaque_authenticated_payload, state, created_at, updated_at
      ) VALUES (
        ${keySnapshot.workspace_id}, ${keySnapshot.dek_generation},
        ${keySnapshot.kms_provider_id}, ${keySnapshot.key_ref}, ${keySnapshot.key_version},
        ${keySnapshot.payload_format}, ${keySnapshot.payload_format_id},
        ${keySnapshot.ciphertext}, ${keySnapshot.nonce}, ${keySnapshot.auth_tag},
        ${keySnapshot.aad_context}, ${keySnapshot.opaque_authenticated_payload},
        ${keySnapshot.state}, ${keySnapshot.created_at}, ${keySnapshot.updated_at}
      )
    `
    await sql`
      UPDATE workspace_provider_credential_fields SET
        dek_generation = ${fieldSnapshot.dek_generation},
        envelope_version = ${fieldSnapshot.envelope_version},
        ciphertext = ${fieldSnapshot.ciphertext},
        nonce = ${fieldSnapshot.nonce},
        auth_tag = ${fieldSnapshot.auth_tag},
        aad_context = ${fieldSnapshot.aad_context},
        deleted_at = NULL,
        deletion_reason = NULL
      WHERE workspace_id = ${workspaceId} AND provider_id = ${providerId}
        AND credential_version = ${fieldSnapshot.credential_version}
        AND field_id = ${fieldSnapshot.field_id}
    `
    await sql`DELETE FROM workspace_credential_shreds WHERE workspace_id = ${workspaceId}`

    const restarted = createBackend()
    await expect(restarted.read(workspaceId, providerId, [fieldId]))
      .rejects.toMatchObject({
        code: CREDENTIAL_ERROR_CODES.UNREADABLE,
      } satisfies Partial<CredentialResolutionError>)
    await expect(restarted.writeCredentialFields({
      workspaceId,
      providerId,
      fields: new Map([[fieldId, new TextEncoder().encode('restored-secret')]]),
    })).rejects.toMatchObject({
      code: CREDENTIAL_ERROR_CODES.UNREADABLE,
    } satisfies Partial<CredentialResolutionError>)
  })
})
