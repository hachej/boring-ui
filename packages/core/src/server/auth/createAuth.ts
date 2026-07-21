import { betterAuth, APIError, type Auth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins/magic-link'
import { ZxcvbnFactory } from '@zxcvbn-ts/core'
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
import { isCoreEmailVerificationEnabled } from '../../shared/authPolicy.js'
import { ERROR_CODES } from '../../shared/errors.js'
import { safeCapture, noopTelemetry, type TelemetrySink } from '../../shared/telemetry.js'

const MIN_ZXCVBN_SCORE = 2

let zxcvbnInstance: ZxcvbnFactory | null = null
function getZxcvbn() {
  if (zxcvbnInstance) return zxcvbnInstance
  zxcvbnInstance = new ZxcvbnFactory({
    translations: zxcvbnEn.translations,
    graphs: zxcvbnCommon.adjacencyGraphs,
    dictionary: {
      ...zxcvbnCommon.dictionary,
      ...zxcvbnEn.dictionary,
    },
  })
  return zxcvbnInstance
}

export function validatePasswordStrength(password: string): { valid: boolean; message?: string } {
  const result = getZxcvbn().check(password)
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
  /** Telemetry sink for auth.signed_up / auth.session_started (defaults to noop). */
  telemetry?: TelemetrySink
  disableDefaultWorkspaceCreation?: boolean
  scopeInvitesToRequestWorkspace?: boolean
  disableInviteAcceptance?: boolean
  /** Validated explicit parent domain; never derived from a request. */
  sharedAuthCookieDomain?: string
  /** Validated exact HTTPS product origins used only by shared-domain auth. */
  sharedAuthTrustedOrigins?: readonly string[]
}

async function createReplayableRequest(request: Request): Promise<Request> {
  if (request.bodyUsed || request.method === 'GET' || request.method === 'HEAD') return request

  const body = await request.text()
  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    body,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    keepalive: request.keepalive,
    credentials: request.credentials,
    cache: request.cache,
    mode: request.mode,
  }

  const replayable = new Request(request.url, init)
  Object.defineProperty(replayable, 'clone', {
    configurable: true,
    value: () => new Request(request.url, init),
  })
  return replayable
}

const AUTH_REDIRECT_FIELDS = [
  'callbackURL',
  'redirectTo',
  'errorCallbackURL',
  'newUserCallbackURL',
] as const

async function hasUntrustedAuthRedirect(
  request: Request,
  baseUrl: string,
  trustedOrigins: ReadonlySet<string>,
): Promise<boolean> {
  const requestUrl = new URL(request.url)
  const values: unknown[] = AUTH_REDIRECT_FIELDS.flatMap((field) =>
    requestUrl.searchParams.getAll(field))
  const contentType = request.headers.get('content-type') ?? ''

  if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    if (contentType.includes('application/json')) {
      const body = await request.clone().json().catch(() => undefined)
      if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
        const record = body as Record<string, unknown>
        values.push(...AUTH_REDIRECT_FIELDS.map((field) => record[field]))
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const body = new URLSearchParams(await request.clone().text())
      values.push(...AUTH_REDIRECT_FIELDS.flatMap((field) => body.getAll(field)))
    }
  }

  return values.some((value) => {
    if (value === undefined) return false
    if (typeof value !== 'string' || value.length === 0) return true
    try {
      return !trustedOrigins.has(new URL(value, baseUrl).origin)
    } catch {
      return true
    }
  })
}

export function createAuth(config: CoreConfig, db: Database, opts?: CreateAuthOptions): Auth<any> {
  const transport = buildMailTransport(config)
  const telemetry = opts?.telemetry ?? noopTelemetry
  const emailVerificationEnabled = isCoreEmailVerificationEnabled(config)

  const emailVerificationConfig = emailVerificationEnabled && transport
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
        disableDefaultWorkspaceCreation: opts.disableDefaultWorkspaceCreation,
        scopeInvitesToRequestWorkspace: opts.scopeInvitesToRequestWorkspace,
        disableInviteAcceptance: opts.disableInviteAcceptance,
      })
    : undefined

  const socialProviders = {
    ...(config.auth.github
      ? {
          github: {
            clientId: config.auth.github.clientId,
            clientSecret: config.auth.github.clientSecret,
          },
        }
      : {}),
    ...(config.features.googleOauth && config.auth.google
      ? {
          google: {
            clientId: config.auth.google.clientId,
            clientSecret: config.auth.google.clientSecret,
          },
        }
      : {}),
  }

  const auth = betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    secret: config.auth.secret,
    baseURL: config.auth.url,
    basePath: '/auth',
    trustedOrigins: opts?.sharedAuthTrustedOrigins
      ? [...opts.sharedAuthTrustedOrigins]
      : config.cors.origins,
    databaseHooks: {
      user: {
        create: {
          // auth.signed_up is emitted here (not in postSignupHook) so it fires for ALL
          // signups, independent of whether workspace post-signup setup is wired.
          // distinctId = user id; no properties (no PII, nothing the DB sink would drop).
          after: async (user: { id?: string } & Record<string, unknown>, ctx: unknown) => {
            safeCapture(telemetry, {
              name: 'auth.signed_up',
              distinctId: typeof user?.id === 'string' ? user.id : undefined,
            })
            if (postSignupHook) await postSignupHook(user as any, ctx)
          },
        },
      },
      // Fires for every new session — sign-in AND the session minted on sign-up — so the
      // name reflects that (a true returning-sign-in count = session_started minus the
      // first session per user, derivable in SQL). distinctId = user id; no properties.
      session: {
        create: {
          after: async (session: { userId?: string } & Record<string, unknown>) => {
            safeCapture(telemetry, {
              name: 'auth.session_started',
              distinctId: typeof session?.userId === 'string' ? session.userId : undefined,
            })
          },
        },
      },
    },
    advanced: {
      database: {
        generateId: 'uuid',
      },
      cookiePrefix: config.appId,
      useSecureCookies: config.auth.sessionCookieSecure,
      ...(opts?.sharedAuthCookieDomain
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: opts.sharedAuthCookieDomain,
            },
          }
        : {}),
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
    socialProviders,
    plugins,
  })

  const handler = auth.handler.bind(auth)
  const trustedAuthOrigins = opts?.sharedAuthCookieDomain
    ? new Set(opts.sharedAuthTrustedOrigins ?? config.cors.origins)
    : undefined
  auth.handler = async (request: Request) => {
    const replayableRequest = await createReplayableRequest(request)
    if (trustedAuthOrigins) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
        const origin = request.headers.get('origin')
        if (!origin || !trustedAuthOrigins.has(origin)) {
          return Response.json(
            { code: ERROR_CODES.PRODUCT_AUTH_ORIGIN_REJECTED, message: 'Untrusted auth origin' },
            { status: 403 },
          )
        }
      }
      if (await hasUntrustedAuthRedirect(
        replayableRequest,
        config.auth.url,
        trustedAuthOrigins,
      )) {
        return Response.json(
          { code: ERROR_CODES.PRODUCT_AUTH_ORIGIN_REJECTED, message: 'Untrusted auth redirect' },
          { status: 403 },
        )
      }
    }
    return handler(replayableRequest)
  }

  return auth
}

export type BetterAuthInstance = Auth<any>
