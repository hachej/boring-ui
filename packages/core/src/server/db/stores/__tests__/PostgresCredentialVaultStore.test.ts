import {
  chmodSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLocalKekProviderV1 } from '@hachej/boring-agent/server'
import type {
  CredentialFieldId,
  ProviderId,
  WorkspaceKekContextV1,
  WorkspaceKekProviderV1,
  WrappedWorkspaceDekV1,
} from '@hachej/boring-agent/shared'
import { CREDENTIAL_ERROR_CODES } from '@hachej/boring-agent/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import postgres from 'postgres'

import type { CoreConfig } from '../../../../shared/types'
import { runMigrations } from '../../migrate'
import { PostgresCredentialVaultStore } from '../PostgresCredentialVaultStore'

const TEST_DB_URL = process.env.DATABASE_URL
  ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const APP_ID = 'byok-vault-storage-test'
const API_KEY_CANARY = 'sk_vault_canary_123456WXYZ'
const OAUTH_CANARY = 'oauth_refresh_vault_canary_987654'
const AUTHORIZATION_CANARY =
  'Authorization: Bearer vault-header-canary-24680'
const KNOWN_KEK = Buffer.alloc(32, 0x5a)

const BASE_CONFIG: CoreConfig = {
  appId: APP_ID,
  appName: 'BYOK Vault Storage Test',
  appLogo: null,
  port: 0,
  host: '127.0.0.1',
  staticDir: null,
  databaseUrl: TEST_DB_URL,
  stores: 'postgres',
  cors: { origins: ['http://localhost:3000'], credentials: true },
  bodyLimit: 16 * 1024 * 1024,
  logLevel: 'silent' as CoreConfig['logLevel'],
  encryption: { workspaceSettingsKey: 'a'.repeat(64) },
  auth: {
    secret: 's'.repeat(64),
    url: 'http://localhost:3000',
    sessionTtlSeconds: 3600,
    sessionCookieSecure: false,
  },
  features: {
    githubOauth: false,
    googleOauth: false,
    invitesEnabled: true,
    sendWelcomeEmail: true,
    inviteTtlDays: 7,
  },
}

const providerId = (value: string) => value as ProviderId
const fieldId = (value: string) => value as CredentialFieldId

let adminSql: postgres.Sql
let store: PostgresCredentialVaultStore
let ownerId: string
let workspaceId: string
let kekFilePath: string
const observedDeks: Uint8Array[] = []

function observingLocalProvider(): WorkspaceKekProviderV1 {
  const local = createLocalKekProviderV1({
    currentKeyVersion: 1,
    keyFiles: [{ keyVersion: 1, keyRef: 'core-test-kek', filePath: kekFilePath }],
  })
  return Object.freeze({
    contractVersion: local.contractVersion,
    providerId: local.providerId,
    readiness: () => local.readiness(),
    async generateDataKey(context: WorkspaceKekContextV1) {
      const generated = await local.generateDataKey(context)
      observedDeks.push(Uint8Array.from(generated.plaintextDek))
      return generated
    },
    unwrapDataKey: (
      context: WorkspaceKekContextV1,
      wrapped: WrappedWorkspaceDekV1,
    ) => local.unwrapDataKey(context, wrapped),
    rewrapDataKey: local.rewrapDataKey
      ? (
          context: WorkspaceKekContextV1,
          wrapped: WrappedWorkspaceDekV1,
        ) => local.rewrapDataKey!(context, wrapped)
      : undefined,
    close: () => local.close?.() ?? Promise.resolve(),
  })
}

function credentialFields() {
  return new Map<CredentialFieldId, Uint8Array>([
    [fieldId('api-key'), Buffer.from(API_KEY_CANARY)],
    [fieldId('oauth-refresh'), Buffer.from(OAUTH_CANARY)],
    [fieldId('authorization-header'), Buffer.from(AUTHORIZATION_CANARY)],
  ])
}

async function putCanaries(
  targetStore = store,
  targetProviderId = providerId('provider-a'),
) {
  return targetStore.putCredential({
    workspaceId,
    providerId: targetProviderId,
    displayLabel: 'Provider A credential',
    credentialType: 'api-key',
    credentialSchemaVersion: 1,
    dekGeneration: 1,
    fields: credentialFields(),
    maskFieldId: fieldId('api-key'),
    actorId: ownerId,
    requestId: 'core-vault-write-request',
  })
}

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  adminSql = postgres(TEST_DB_URL, { max: 2, debug: false })

  const directory = mkdtempSync(join(tmpdir(), 'boring-core-vault-'))
  kekFilePath = join(directory, 'local-kek')
  writeFileSync(kekFilePath, KNOWN_KEK, { mode: 0o400 })
  chmodSync(kekFilePath, 0o400)

  const tag = crypto.randomUUID()
  const [owner] = await adminSql`
    INSERT INTO users (name, email, email_verified)
    VALUES ('Vault Owner', ${`vault-owner-${tag}@example.test`}, true)
    RETURNING id
  `
  ownerId = owner.id as string
  const [workspace] = await adminSql`
    INSERT INTO workspaces (app_id, name, created_by, is_default)
    VALUES (${APP_ID}, 'Vault Test Workspace', ${ownerId}, false)
    RETURNING id
  `
  workspaceId = workspace.id as string
  store = new PostgresCredentialVaultStore({
    databaseUrl: TEST_DB_URL,
    kekProvider: observingLocalProvider(),
  })
})

afterAll(async () => {
  await store?.close()
  for (const dek of observedDeks) dek.fill(0)
  if (adminSql) {
    await adminSql`
      DELETE FROM workspace_provider_credential_fields
      WHERE workspace_id IN (
        SELECT id FROM workspaces WHERE app_id = ${APP_ID}
      )
    `
    await adminSql`
      DELETE FROM workspace_provider_credentials
      WHERE workspace_id IN (
        SELECT id FROM workspaces WHERE app_id = ${APP_ID}
      )
    `
    await adminSql`
      DELETE FROM workspace_credential_keys
      WHERE workspace_id IN (
        SELECT id FROM workspaces WHERE app_id = ${APP_ID}
      )
    `
    await adminSql`
      DELETE FROM workspace_members
      WHERE workspace_id IN (
        SELECT id FROM workspaces WHERE app_id = ${APP_ID}
      )
    `
    await adminSql`DELETE FROM workspaces WHERE app_id = ${APP_ID}`
    await adminSql`DELETE FROM users WHERE id = ${ownerId}`
    await adminSql.end()
  }
})

beforeEach(async () => {
  for (const dek of observedDeks) dek.fill(0)
  observedDeks.length = 0
  await adminSql`
    DELETE FROM workspace_provider_credential_fields
    WHERE workspace_id = ${workspaceId}
  `
  await adminSql`
    DELETE FROM workspace_provider_credentials
    WHERE workspace_id = ${workspaceId}
  `
  await adminSql`
    DELETE FROM workspace_credential_keys
    WHERE workspace_id = ${workspaceId}
  `
})

describe('PostgresCredentialVaultStore conformance', () => {
  test('raw SQL inspection finds no plaintext, DEK, KEK, OAuth, or auth-header canary', async () => {
    await putCanaries()
    expect(observedDeks).toHaveLength(1)

    const credentialRows = await adminSql`
      SELECT row_to_json(c)::text AS row
      FROM workspace_provider_credentials c
      WHERE workspace_id = ${workspaceId} AND provider_id = 'provider-a'
    `
    const fieldRows = await adminSql`
      SELECT row_to_json(f)::text AS row
      FROM workspace_provider_credential_fields f
      WHERE workspace_id = ${workspaceId} AND provider_id = 'provider-a'
    `
    const keyRows = await adminSql`
      SELECT row_to_json(k)::text AS row
      FROM workspace_credential_keys k
      WHERE workspace_id = ${workspaceId}
    `
    const rawDump = [...credentialRows, ...fieldRows, ...keyRows]
      .map((row) => String(row.row))
      .join('\n')
      .toLowerCase()
    const forbiddenBytes = [
      Buffer.from(API_KEY_CANARY),
      Buffer.from(OAUTH_CANARY),
      Buffer.from(AUTHORIZATION_CANARY),
      KNOWN_KEK,
      Buffer.from(observedDeks[0]),
    ]
    for (const forbidden of forbiddenBytes) {
      expect(rawDump).not.toContain(forbidden.toString('utf8').toLowerCase())
      expect(rawDump).not.toContain(forbidden.toString('hex').toLowerCase())
    }
    expect(rawDump).not.toContain('workspace_settings_encryption_key')
  })

  test('round-trips exact bytes and stores last-four metadata only', async () => {
    const written = await putCanaries()
    expect(written).toEqual({
      credentialVersion: 1,
      dekGeneration: 1,
      maskedLastFourSuffix: 'WXYZ',
    })

    const resolved = await store.read(
      workspaceId,
      providerId('provider-a'),
      [fieldId('api-key'), fieldId('oauth-refresh'), fieldId('authorization-header')],
    )
    expect(resolved.kind).toBe('field-set')
    if (resolved.kind !== 'field-set') throw new Error('field-set expected')
    expect(Buffer.from(resolved.fields.get(fieldId('api-key'))!)).toEqual(
      Buffer.from(API_KEY_CANARY),
    )
    expect(Buffer.from(resolved.fields.get(fieldId('oauth-refresh'))!)).toEqual(
      Buffer.from(OAUTH_CANARY),
    )
    expect(Buffer.from(resolved.fields.get(fieldId('authorization-header'))!)).toEqual(
      Buffer.from(AUTHORIZATION_CANARY),
    )

    const [metadata] = await adminSql`
      SELECT masked_last_four_suffix, active_credential_version
      FROM workspace_provider_credentials
      WHERE workspace_id = ${workspaceId} AND provider_id = 'provider-a'
    `
    expect(metadata).toEqual(expect.objectContaining({
      masked_last_four_suffix: 'WXYZ',
      active_credential_version: 1,
    }))
    for (const value of resolved.fields.values()) value.fill(0)
  })

  test('stores configured instead of revealing a too-short suffix', async () => {
    const result = await store.putCredential({
      workspaceId,
      providerId: providerId('provider-a'),
      displayLabel: 'Short credential',
      credentialType: 'api-key',
      credentialSchemaVersion: 1,
      dekGeneration: 1,
      fields: new Map([[fieldId('api-key'), Buffer.from('short')]]),
      actorId: ownerId,
      requestId: 'short-mask-request',
    })
    expect(result.maskedLastFourSuffix).toBe('configured')
  })

  test('distinguishes fallback suppression from explicitly enabled instance fallback', async () => {
    await putCanaries()
    await adminSql`
      UPDATE workspace_provider_credentials
      SET state = 'intentionally_absent'
      WHERE workspace_id = ${workspaceId} AND provider_id = 'provider-a'
    `
    await expect(store.read(
      workspaceId,
      providerId('provider-a'),
      [fieldId('api-key')],
    )).rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.REVOKED })

    await adminSql`
      UPDATE workspace_provider_credentials
      SET state = 'instance_fallback_enabled'
      WHERE workspace_id = ${workspaceId} AND provider_id = 'provider-a'
    `
    await expect(store.read(
      workspaceId,
      providerId('provider-a'),
      [fieldId('api-key')],
    )).rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.NOT_CONFIGURED })
  })

  test('persisted envelope corruption fails closed as unreadable', async () => {
    await putCanaries()
    await adminSql`
      UPDATE workspace_provider_credential_fields
      SET auth_tag = set_byte(
        auth_tag,
        0,
        (get_byte(auth_tag, 0) + 1) % 256
      )
      WHERE workspace_id = ${workspaceId}
        AND provider_id = 'provider-a'
        AND field_id = 'api-key'
    `

    await expect(store.read(
      workspaceId,
      providerId('provider-a'),
      [fieldId('api-key')],
    )).rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.UNREADABLE })
  })

  test('copied persisted rows fail cross-workspace AAD authentication', async () => {
    await putCanaries()
    const [targetWorkspace] = await adminSql`
      INSERT INTO workspaces (app_id, name, created_by, is_default)
      VALUES (${APP_ID}, 'Vault Copy Target', ${ownerId}, false)
      RETURNING id
    `
    const targetWorkspaceId = targetWorkspace.id as string
    try {
      await adminSql.begin(async (tx) => {
        await tx`
          INSERT INTO workspace_credential_keys (
            workspace_id, dek_generation, kek_provider_id, key_ref, key_version,
            wrapper_format, wrapped_payload, wrapper_nonce, wrapper_auth_tag,
            wrapper_aad_context, state
          )
          SELECT
            ${targetWorkspaceId}, dek_generation, kek_provider_id, key_ref,
            key_version, wrapper_format, wrapped_payload, wrapper_nonce,
            wrapper_auth_tag, wrapper_aad_context, state
          FROM workspace_credential_keys
          WHERE workspace_id = ${workspaceId}
        `
        await tx`
          INSERT INTO workspace_provider_credentials (
            workspace_id, provider_id, display_label, credential_type,
            credential_schema_version, state, active_credential_version,
            dek_generation, masked_last_four_suffix, created_by_actor_id,
            updated_by_actor_id
          )
          SELECT
            ${targetWorkspaceId}, provider_id, display_label, credential_type,
            credential_schema_version, state, active_credential_version,
            dek_generation, masked_last_four_suffix, created_by_actor_id,
            updated_by_actor_id
          FROM workspace_provider_credentials
          WHERE workspace_id = ${workspaceId} AND provider_id = 'provider-a'
        `
        await tx`
          INSERT INTO workspace_provider_credential_fields (
            workspace_id, provider_id, credential_version, field_id,
            envelope_version, ciphertext, nonce, auth_tag, aad_context,
            dek_generation
          )
          SELECT
            ${targetWorkspaceId}, provider_id, credential_version, field_id,
            envelope_version, ciphertext, nonce, auth_tag, aad_context,
            dek_generation
          FROM workspace_provider_credential_fields
          WHERE workspace_id = ${workspaceId} AND provider_id = 'provider-a'
        `
      })

      await expect(store.read(
        targetWorkspaceId,
        providerId('provider-a'),
        [fieldId('api-key')],
      )).rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.UNREADABLE })
    } finally {
      await adminSql`DELETE FROM workspaces WHERE id = ${targetWorkspaceId}`
    }
  })

  test('uses a dedicated unlogged connection even when global debug flags are enabled', async () => {
    const priorDebug = process.env.DEBUG
    process.env.DEBUG = 'drizzle:*,postgres:*'
    const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const loggingStore = new PostgresCredentialVaultStore({
      databaseUrl: TEST_DB_URL,
      kekProvider: observingLocalProvider(),
      maxConnections: 1,
    })
    try {
      await putCanaries(loggingStore, providerId('provider-logging'))
      const resolved = await loggingStore.read(
        workspaceId,
        providerId('provider-logging'),
        [fieldId('api-key')],
      )
      if (resolved.kind === 'field-set') {
        for (const value of resolved.fields.values()) value.fill(0)
      }
      const logged = [...consoleDebug.mock.calls, ...consoleLog.mock.calls]
        .flat()
        .map(String)
        .join('\n')
      expect(logged).toBe('')
      expect(logged).not.toContain(API_KEY_CANARY)
      expect(logged).not.toMatch(/WHERE.+sk_vault/i)
    } finally {
      await loggingStore.close()
      consoleDebug.mockRestore()
      consoleLog.mockRestore()
      if (priorDebug === undefined) delete process.env.DEBUG
      else process.env.DEBUG = priorDebug
    }
  })

  test('workspace deletion cascades vault rows while standalone key deletion stays fenced', async () => {
    const [workspace] = await adminSql`
      INSERT INTO workspaces (app_id, name, created_by, is_default)
      VALUES (${APP_ID}, 'Vault Cascade Workspace', ${ownerId}, false)
      RETURNING id
    `
    const cascadeWorkspaceId = workspace.id as string
    await store.putCredential({
      workspaceId: cascadeWorkspaceId,
      providerId: providerId('provider-cascade'),
      displayLabel: 'Cascade credential',
      credentialType: 'api-key',
      credentialSchemaVersion: 1,
      dekGeneration: 1,
      fields: new Map([[fieldId('api-key'), Buffer.from(API_KEY_CANARY)]]),
      actorId: ownerId,
      requestId: 'cascade-delete-request',
    })

    await expect(adminSql`
      DELETE FROM workspace_credential_keys
      WHERE workspace_id = ${cascadeWorkspaceId} AND dek_generation = 1
    `).rejects.toMatchObject({ code: '23503' })
    await adminSql`DELETE FROM workspaces WHERE id = ${cascadeWorkspaceId}`

    for (const table of [
      'workspace_provider_credential_fields',
      'workspace_provider_credentials',
      'workspace_credential_keys',
    ]) {
      const [row] = await adminSql`
        SELECT count(*)::int AS count
        FROM ${adminSql(table)}
        WHERE workspace_id = ${cascadeWorkspaceId}
      `
      expect(row.count).toBe(0)
    }
  })

  test('deleting an actor retains credential metadata without pinning the user row', async () => {
    const [actor] = await adminSql`
      INSERT INTO users (name, email, email_verified)
      VALUES ('Former Vault Actor', ${`former-vault-actor-${crypto.randomUUID()}@example.test`}, true)
      RETURNING id
    `
    const actorId = actor.id as string
    await store.putCredential({
      workspaceId,
      providerId: providerId('provider-former-actor'),
      displayLabel: 'Former actor credential',
      credentialType: 'api-key',
      credentialSchemaVersion: 1,
      dekGeneration: 1,
      fields: new Map([[fieldId('api-key'), Buffer.from(API_KEY_CANARY)]]),
      actorId,
      requestId: 'actor-delete-request',
    })

    await adminSql`DELETE FROM users WHERE id = ${actorId}`
    const [metadata] = await adminSql`
      SELECT created_by_actor_id, updated_by_actor_id
      FROM workspace_provider_credentials
      WHERE workspace_id = ${workspaceId}
        AND provider_id = 'provider-former-actor'
    `
    expect(metadata).toEqual(expect.objectContaining({
      created_by_actor_id: null,
      updated_by_actor_id: null,
    }))
  })
})
