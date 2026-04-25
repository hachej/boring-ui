import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins/magic-link'

// Schema-only config for better-auth CLI generation. Do not import in runtime code.
// The fallback URL is for local schema generation only.
const schemaDatabaseUrl =
  process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const schemaGenerationAllowed =
  process.env.BETTER_AUTH_SCHEMA_GEN === '1' ||
  process.env.VITEST === 'true' ||
  process.env.NODE_ENV === 'test'

let sqlClient: ReturnType<typeof postgres> | undefined
let drizzleDb: ReturnType<typeof drizzle> | undefined

const getSchemaDb = (): ReturnType<typeof drizzle> => {
  if (!schemaGenerationAllowed) {
    throw new Error(
      'schema-config.ts is schema-generation only. Set BETTER_AUTH_SCHEMA_GEN=1 before use.',
    )
  }

  if (!drizzleDb) {
    sqlClient = postgres(schemaDatabaseUrl, {
      max: 1,
      prepare: false,
      idle_timeout: 1,
      connect_timeout: 1,
    })
    drizzleDb = drizzle(sqlClient)
  }

  return drizzleDb
}

const lazyDb: ReturnType<typeof drizzle> = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop, receiver) {
    const db = getSchemaDb() as unknown as Record<PropertyKey, unknown>
    const value = Reflect.get(db, prop, receiver)
    return typeof value === 'function' ? value.bind(db) : value
  },
})

export const closeSchemaDb = async (): Promise<void> => {
  if (!sqlClient) {
    return
  }

  await sqlClient.end({ timeout: 1 })
  sqlClient = undefined
  drizzleDb = undefined
}

export const schemaAuthConfig: Parameters<typeof betterAuth>[0] = {
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  advanced: {
    database: {
      generateId: 'uuid',
    },
  },
  database: drizzleAdapter(lazyDb, { provider: 'pg' }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    modelName: 'users',
    fields: {
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  session: {
    modelName: 'sessions',
    fields: {
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  account: {
    modelName: 'accounts',
    fields: {
      accountId: 'account_id',
      providerId: 'provider_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      idToken: 'id_token',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  verification: {
    modelName: 'verification_tokens',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  plugins: [
    magicLink({
      // schema-only: callback intentionally stubbed for generation
      sendMagicLink: async () => {},
    }),
  ],
}

export const auth = betterAuth(schemaAuthConfig)
