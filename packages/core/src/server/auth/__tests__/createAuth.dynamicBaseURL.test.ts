import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import type { CoreConfig } from '../../../shared/types'
import { createDatabase, type Database } from '../../db/connection'
import { runMigrations } from '../../db/migrate'
import { createAuth, type BetterAuthInstance } from '../createAuth'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'

function makeConfig(): CoreConfig {
  return {
    appId: 'test-app',
    appName: 'Test App',
    appLogo: null,
    port: 0,
    host: '127.0.0.1',
    staticDir: null,
    databaseUrl: TEST_DB_URL,
    stores: 'postgres',
    cors: {
      origins: ['https://app.example.test', 'https://agent.example.test'],
      credentials: true,
    },
    bodyLimit: 16 * 1024 * 1024,
    logLevel: 'silent' as CoreConfig['logLevel'],
    encryption: { workspaceSettingsKey: 'a'.repeat(64) },
    auth: {
      secret: 's'.repeat(64),
      url: 'https://canonical.example.test',
      sessionTtlSeconds: 3600,
      sessionCookieSecure: true,
      google: {
        clientId: 'google-client-id',
        clientSecret: 'google-client-secret',
      },
    },
    features: {
      githubOauth: false,
      googleOauth: true,
      invitesEnabled: true,
      sendWelcomeEmail: true,
      inviteTtlDays: 7,
    },
  }
}

let auth: BetterAuthInstance
let db: Database
let rawSql: postgres.Sql
const oauthStates: string[] = []

beforeAll(async () => {
  const config = makeConfig()
  await runMigrations(config)
  const connection = createDatabase(config)
  db = connection.db
  rawSql = connection.sql
  auth = createAuth(config, db, {
    baseURL: {
      allowedHosts: ['app.example.test', 'agent.example.test'],
      protocol: 'https',
    },
  })
})

afterAll(async () => {
  for (const state of oauthStates) {
    await rawSql`DELETE FROM verification_tokens WHERE identifier = ${state}`
  }
  await rawSql.end()
})

async function startGoogleSignIn(
  host: string,
  forwardedHost?: string,
): Promise<{ response: Response; redirectURI?: string }> {
  const headers = new Headers({
    'content-type': 'application/json',
    host,
  })
  if (forwardedHost) headers.set('x-forwarded-host', forwardedHost)

  const response = await auth.handler(new Request(
    'https://canonical.example.test/auth/sign-in/social',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider: 'google',
        disableRedirect: true,
        callbackURL: '/',
      }),
    },
  ))

  const body = await response.json() as { url: string }
  const authorizationURL = new URL(body.url)
  const state = authorizationURL.searchParams.get('state')
  if (state) oauthStates.push(state)
  return {
    response,
    redirectURI: authorizationURL.searchParams.get('redirect_uri') ?? undefined,
  }
}

describe('createAuth dynamic base URL behavior', () => {
  it.each(['app.example.test', 'agent.example.test'])(
    'uses the initiating allowed Host for Google callback on %s',
    async (host) => {
      const result = await startGoogleSignIn(host)

      expect(result.response.status).toBe(200)
      expect(result.redirectURI).toBe(`https://${host}/auth/callback/google`)
      expect(result.response.headers.get('set-cookie')).toBeTruthy()
      expect(result.response.headers.get('set-cookie')).not.toMatch(/;\s*domain=/i)
    },
  )

  it('rejects an unlisted Host', async () => {
    await expect(startGoogleSignIn('evil.example.test')).rejects.toThrow(
      /Host "evil\.example\.test" is not in the allowed hosts list/,
    )
  })

  it('does not let X-Forwarded-Host override an allowed Host', async () => {
    const result = await startGoogleSignIn('app.example.test', 'agent.example.test')

    expect(result.response.status).toBe(200)
    expect(result.redirectURI).toBe('https://app.example.test/auth/callback/google')
  })
})
