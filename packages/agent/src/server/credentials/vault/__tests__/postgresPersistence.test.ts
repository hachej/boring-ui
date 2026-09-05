import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
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
      const faultAnchor = boundary === 'anchor-advance'
        ? {
            ...anchor,
            async withDekGenerationMutation<T>(
              requestedWorkspaceId: string,
              mutate: Parameters<typeof anchor.withDekGenerationMutation<T>>[1],
            ): Promise<T> {
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
      expect(await anchor.read(workspaceId)).toMatchObject({ dekGeneration: 2 })
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
