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
import {
  createInMemoryCredentialVersionAnchorV1,
  createLocalFileCredentialVersionAnchorV1,
  createLocalKekWorkspaceKekProviderV1,
  createPostgresCredentialVaultPersistenceV1,
  createVaultCredentialStoreBackendV1,
  initializeLocalFileCredentialVersionAnchorV1,
  runCredentialVaultPostgresMigrationsV1,
} from '..'
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
  test('migration is idempotent', async () => {
    await runCredentialVaultPostgresMigrationsV1(sql)
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
})
