import { z } from 'zod'

const VALID_MAIL_SCHEMES = ['resend://', 'smtp://', 'smtps://', 'console://']

const logLevelSchema = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
])

const rateLimitEndpointOverrideSchema = z.object({
  max: z.number().int().positive(),
  window: z.string().min(1),
})

const mailTransportUrlSchema = z.string().refine(
  (url) => VALID_MAIL_SCHEMES.some((s) => url.startsWith(s)),
  {
    message: `Mail transport URL must start with one of: ${VALID_MAIL_SCHEMES.join(', ')}`,
  },
)

export const coreConfigSchema = z.object({
  appId: z.string().min(1),
  appName: z.string().min(1),
  appLogo: z.string().nullable(),

  port: z.number().int().min(1).max(65535),
  host: z.string().min(1),
  staticDir: z.string().nullable(),

  databaseUrl: z.string().nullable(),
  stores: z.enum(['postgres', 'local']),

  cors: z.object({
    origins: z.array(z.string()),
    credentials: z.literal(true),
  }),

  bodyLimit: z.number().int().positive(),
  logLevel: logLevelSchema,
  rateLimit: z.record(rateLimitEndpointOverrideSchema).optional(),

  encryption: z.object({
    workspaceSettingsKey: z.string().min(1),
  }),

  auth: z.object({
    secret: z.string().min(1),
    url: z.string().url(),
    github: z
      .object({
        clientId: z.string().min(1),
        clientSecret: z.string().min(1),
      })
      .optional(),
    mail: z
      .object({
        from: z.string().min(1),
        transportUrl: mailTransportUrlSchema,
      })
      .optional(),
    sessionTtlSeconds: z.number().int().positive(),
    sessionCookieSecure: z.boolean(),
  }),

  features: z.object({
    githubOauth: z.boolean(),
    invitesEnabled: z.boolean(),
    sendWelcomeEmail: z.boolean(),
  }),
})

export type CoreConfigZod = z.infer<typeof coreConfigSchema>
