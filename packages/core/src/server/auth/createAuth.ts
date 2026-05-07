import { betterAuth, APIError, type Auth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins/magic-link'
import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core'
import * as zxcvbnCommon from '@zxcvbn-ts/language-common'
import * as zxcvbnEn from '@zxcvbn-ts/language-en'
import type { CoreConfig } from '../../shared/types.js'
import type { Database } from '../db/connection.js'
import type { WorkspaceStore } from '../app/types.js'
import * as schema from '../db/schema.js'
import { createMailTransport } from '../mail/transport.js'
import type { MailTransport } from '../mail/transport.js'
import {
  renderVerifyEmail,
  renderResetPassword,
  renderMagicLink,
} from '../mail/templates/index.js'
import { createPostSignupHook } from './postSignupHook.js'

const MIN_ZXCVBN_SCORE = 2

let zxcvbnInitialized = false
function ensureZxcvbn() {
  if (zxcvbnInitialized) return
  zxcvbnOptions.setOptions({
    translations: zxcvbnEn.translations,
    graphs: zxcvbnCommon.adjacencyGraphs,
    dictionary: {
      ...zxcvbnCommon.dictionary,
      ...zxcvbnEn.dictionary,
    },
  })
  zxcvbnInitialized = true
}

export function validatePasswordStrength(password: string): { valid: boolean; message?: string } {
  ensureZxcvbn()
  const result = zxcvbn(password)
  if (result.score < MIN_ZXCVBN_SCORE) {
    return {
      valid: false,
      message: 'This password is too common. Please choose another.',
    }
  }
  return { valid: true }
}

function buildMailTransport(config: CoreConfig): MailTransport | null {
  if (!config.auth.mail) return null
  const env = process.env.NODE_ENV === 'production'
    ? 'production' as const
    : process.env.NODE_ENV === 'test'
      ? 'test' as const
      : 'development' as const
  return createMailTransport(config.auth.mail.transportUrl, config.auth.mail.from, env)
}

export interface CreateAuthOptions {
  workspaceStore?: WorkspaceStore
  logger?: { warn: (obj: Record<string, unknown>, msg: string) => void }
}

export function createAuth(config: CoreConfig, db: Database, opts?: CreateAuthOptions): Auth<any> {
  const transport = buildMailTransport(config)

  const emailVerificationConfig = transport
    ? {
        sendOnSignUp: true as const,
        sendVerificationEmail: async (data: any) => {
          const email = await renderVerifyEmail({
            to: data.user.email,
            verifyUrl: data.url,
            appName: config.appName,
            expiresInHours: 24,
          })
          await transport.send(email)
        },
      }
    : undefined

  const sendResetPasswordFn = transport
    ? async (data: any) => {
        const email = await renderResetPassword({
          to: data.user.email,
          resetUrl: data.url,
          appName: config.appName,
          expiresInHours: 1,
        })
        await transport.send(email)
      }
    : undefined

  const plugins = transport
    ? [
        magicLink({
          sendMagicLink: async (data: { email: string; url: string; token: string }) => {
            const email = await renderMagicLink({
              to: data.email,
              loginUrl: data.url,
              appName: config.appName,
              expiresInMinutes: 10,
            })
            await transport.send(email)
          },
        }),
      ]
    : []

  const postSignupHook = opts?.workspaceStore
    ? createPostSignupHook({
        config,
        workspaceStore: opts.workspaceStore,
        transport,
        logger: opts.logger,
      })
    : undefined

  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    secret: config.auth.secret,
    baseURL: config.auth.url,
    basePath: '/auth',
    trustedOrigins: config.cors.origins,
    databaseHooks: postSignupHook
      ? {
          user: {
            create: {
              after: postSignupHook as any,
            },
          },
        }
      : undefined,
    advanced: {
      database: {
        generateId: 'uuid',
      },
      cookiePrefix: config.appId,
      useSecureCookies: config.auth.sessionCookieSecure,
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
      expiresIn: config.auth.sessionTtlSeconds,
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
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      sendResetPassword: sendResetPasswordFn,
      password: {
        async hash(password: string) {
          const check = validatePasswordStrength(password)
          if (!check.valid) {
            throw APIError.from('BAD_REQUEST', {
              message: check.message!,
              code: 'WEAK_PASSWORD',
            })
          }
          const { hashPassword } = await import('better-auth/crypto')
          return hashPassword(password)
        },
      },
    },
    emailVerification: emailVerificationConfig,
    socialProviders: config.auth.github
      ? { github: { clientId: config.auth.github.clientId, clientSecret: config.auth.github.clientSecret } }
      : {},
    plugins,
  })
}

export type BetterAuthInstance = Auth<any>
