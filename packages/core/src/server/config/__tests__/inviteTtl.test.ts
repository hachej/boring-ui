import { describe, it, expect, vi, beforeEach } from 'vitest'
import { coreConfigSchema } from '../schema'
import { LocalUserStore } from '../../db/stores/LocalUserStore'
import { LocalWorkspaceStore } from '../../db/stores/LocalWorkspaceStore'

import { withBeadId } from '../../__tests__/_setup'

const BEAD_ID = 'boring-ui-v2-ra6l'

function buildValidConfig(overrides: Record<string, unknown> = {}) {
  return {
    appId: 'test',
    appName: 'Test',
    appLogo: null,
    port: 3000,
    host: '0.0.0.0',
    staticDir: null,
    databaseUrl: null,
    stores: 'local',
    cors: { origins: ['http://localhost:3000'], credentials: true as const },
    bodyLimit: 1_048_576,
    logLevel: 'info',
    encryption: { workspaceSettingsKey: 'a'.repeat(64) },
    auth: {
      secret: 'x'.repeat(64),
      url: 'http://localhost:3000',
      sessionTtlSeconds: 86400,
      sessionCookieSecure: false,
    },
    features: {
      githubOauth: false,
      invitesEnabled: true,
      sendWelcomeEmail: false,
      ...overrides,
    },
  }
}

describe('inviteTtlDays config', () => {
  it(
    'rejects inviteTtlDays = 0',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const result = coreConfigSchema.safeParse(buildValidConfig({ inviteTtlDays: 0 }))
      expect(result.success).toBe(false)
      assertionPassed('rejects-zero')
    }),
  )

  it(
    'rejects inviteTtlDays = 31',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const result = coreConfigSchema.safeParse(buildValidConfig({ inviteTtlDays: 31 }))
      expect(result.success).toBe(false)
      assertionPassed('rejects-31')
    }),
  )

  it(
    'accepts inviteTtlDays = 7',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const result = coreConfigSchema.safeParse(buildValidConfig({ inviteTtlDays: 7 }))
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.features.inviteTtlDays).toBe(7)
      }
      assertionPassed('accepts-7')
    }),
  )

  it(
    'defaults to 7 when omitted',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const result = coreConfigSchema.safeParse(buildValidConfig())
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.features.inviteTtlDays).toBe(7)
      }
      assertionPassed('default-7')
    }),
  )
})

describe('createInvite TTL from config', () => {
  let userStore: LocalUserStore
  let store: LocalWorkspaceStore

  beforeEach(() => {
    userStore = new LocalUserStore()
    store = new LocalWorkspaceStore(userStore)
    userStore.seed({ id: 'alice', email: 'alice@test.dev', name: 'Alice', emailVerified: true, image: null })
  })

  it(
    'honors ttlDays = 3 from config',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const ws = await store.create('alice', 'TestWS', 'test-app')
      const before = Date.now()
      const { invite } = await store.createInvite(ws.id, 'bob@test.dev', 'editor', 'alice', { ttlDays: 3 })
      const after = Date.now()

      const expiresMs = new Date(invite.expiresAt).getTime()
      const expectedMinMs = before + 3 * 24 * 60 * 60 * 1000
      const expectedMaxMs = after + 3 * 24 * 60 * 60 * 1000

      expect(expiresMs).toBeGreaterThanOrEqual(expectedMinMs)
      expect(expiresMs).toBeLessThanOrEqual(expectedMaxMs)

      assertionPassed('ttl-3-days')
    }),
  )

  it(
    'defaults to 7 days when ttlDays not provided',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const ws = await store.create('alice', 'TestWS', 'test-app')
      const before = Date.now()
      const { invite } = await store.createInvite(ws.id, 'bob@test.dev', 'editor', 'alice')
      const after = Date.now()

      const expiresMs = new Date(invite.expiresAt).getTime()
      const expectedMinMs = before + 7 * 24 * 60 * 60 * 1000
      const expectedMaxMs = after + 7 * 24 * 60 * 60 * 1000

      expect(expiresMs).toBeGreaterThanOrEqual(expectedMinMs)
      expect(expiresMs).toBeLessThanOrEqual(expectedMaxMs)

      assertionPassed('default-ttl-7-days')
    }),
  )
})
