import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { z } from 'zod'
import type { Database } from '../db/connection.js'
import type { WorkspaceStore } from '../app/types.js'
import { ERROR_CODES, HttpError } from '../../shared/errors.js'
import {
  DefaultExperienceProvisioner,
  type OutreachCreditGrantStore,
  consumeOutreachForUser,
  createOutreachExperience,
  createOutreachLink,
  findValidOutreachLink,
  getLeadForUser,
} from './service.js'

export interface OutreachRoutesOptions {
  db: Database
  workspaceStore: WorkspaceStore
  creditGrantStore: OutreachCreditGrantStore
}

const createExperienceBody = z.object({
  name: z.string().min(1),
  provisioningMode: z.enum(['shared_readonly', 'existing_workspace_viewer', 'clone_per_lead']).default('shared_readonly'),
  templateWorkspaceId: z.string().uuid().nullable().optional(),
  defaultTargetPath: z.string().default('/'),
  anonymousCapabilityProfile: z.string().min(1).optional(),
  config: z.record(z.unknown()).optional(),
}).strict()

const createLinkBody = z.object({
  experienceId: z.string().uuid(),
  campaignId: z.string().min(1).nullable().optional(),
  recipientHint: z.string().min(1).nullable().optional(),
  ttlHours: z.number().int().positive().max(24 * 365).optional(),
  maxLeads: z.number().int().positive().nullable().optional(),
  initialCreditMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict()

function toHeaders(source: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(source)) {
    if (!value) continue
    headers.set(key, Array.isArray(value) ? value[0] : value)
  }
  return headers
}

function readMaxInitialCreditMicros(): number {
  const raw = process.env.BORING_OUTREACH_MAX_INITIAL_CREDIT_MICROS
  if (raw === undefined || raw.trim() === '') return 10_000_000
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new HttpError({
      status: 500,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'BORING_OUTREACH_MAX_INITIAL_CREDIT_MICROS must be a non-negative safe integer',
    })
  }
  return parsed
}

function requireOutreachAdmin(user: { email: string; isAnonymousLead?: boolean } | null | undefined): void {
  if (!user || user.isAnonymousLead) {
    throw new HttpError({ status: 403, code: ERROR_CODES.FORBIDDEN, message: 'Outreach administration requires a non-anonymous account' })
  }
  const allowlist = (process.env.BORING_OUTREACH_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  if (allowlist.length === 0) {
    throw new HttpError({ status: 403, code: ERROR_CODES.FORBIDDEN, message: 'Outreach administration requires BORING_OUTREACH_ADMIN_EMAILS' })
  }
  if (!user.email || !allowlist.includes(user.email.toLowerCase())) {
    throw new HttpError({ status: 403, code: ERROR_CODES.FORBIDDEN, message: 'Outreach administration is not enabled for this account' })
  }
}

function setResponseCookies(reply: { header: (name: string, value: string | string[]) => void }, response: Response): void {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const setCookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : headers.get('set-cookie')
      ? [headers.get('set-cookie') as string]
      : []
  if (setCookies.length > 0) {
    reply.header('set-cookie', setCookies.length === 1 ? setCookies[0] : setCookies)
  }
}

async function signInAnonymous(app: { auth: unknown }, headers: Headers): Promise<{ userId: string; response: Response }> {
  const auth = app.auth as {
    api: {
      signInAnonymous: (input: { headers: Headers; asResponse: true }) => Promise<Response>
    }
  }
  if (typeof auth.api.signInAnonymous !== 'function') {
    throw new HttpError({
      status: 501,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Anonymous auth is not configured',
    })
  }

  const response = await auth.api.signInAnonymous({ headers, asResponse: true })
  if (!response.ok) {
    throw new HttpError({
      status: response.status,
      code: ERROR_CODES.UNAUTHORIZED,
      message: 'Anonymous sign-in failed',
    })
  }

  const body = await response.clone().json() as { user?: { id?: unknown } }
  const userId = typeof body.user?.id === 'string' ? body.user.id : null
  if (!userId) {
    throw new HttpError({
      status: 500,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Anonymous sign-in did not return a user id',
    })
  }
  return { userId, response }
}

const outreachRoutesPlugin: FastifyPluginAsync<OutreachRoutesOptions> = async (app, opts) => {
  const provisioner = new DefaultExperienceProvisioner(opts.db, opts.workspaceStore)

  app.addRedactionPaths(['token', '/o/'])

  app.post('/api/v1/outreach/experiences', async (request, reply) => {
    requireOutreachAdmin(request.user)
    const parsed = createExperienceBody.safeParse(request.body)
    if (!parsed.success) {
      throw new HttpError({
        status: 400,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        requestId: request.id,
      })
    }

    const experience = await createOutreachExperience({
      db: opts.db,
      appId: app.config.appId,
      name: parsed.data.name,
      provisioningMode: parsed.data.provisioningMode,
      templateWorkspaceId: parsed.data.templateWorkspaceId ?? null,
      defaultTargetPath: parsed.data.defaultTargetPath,
      anonymousCapabilityProfile: parsed.data.anonymousCapabilityProfile,
      config: parsed.data.config,
      createdBy: request.user?.id ?? null,
    })

    reply.status(201)
    return { experience }
  })

  app.post('/api/v1/outreach-links', async (request, reply) => {
    requireOutreachAdmin(request.user)
    const parsed = createLinkBody.safeParse(request.body)
    if (!parsed.success) {
      throw new HttpError({
        status: 400,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        requestId: request.id,
      })
    }

    const link = await createOutreachLink({
      db: opts.db,
      appId: app.config.appId,
      authSecret: app.config.auth.secret,
      authUrl: app.config.auth.url,
      experienceId: parsed.data.experienceId,
      campaignId: parsed.data.campaignId,
      recipientHint: parsed.data.recipientHint,
      ttlHours: parsed.data.ttlHours,
      maxLeads: parsed.data.maxLeads,
      initialCreditMicros: parsed.data.initialCreditMicros,
      maxInitialCreditMicros: readMaxInitialCreditMicros(),
      createdBy: request.user?.id ?? null,
    })

    reply.status(201)
    return { link }
  })

  app.get('/o/:token', async (request, reply) => {
    const params = request.params as { token?: string }
    const token = params.token
    if (!token) {
      throw new HttpError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: 'Outreach link not found' })
    }

    const sessionHeaders = toHeaders(request.headers)
    if (request.user?.id) {
      const existingLead = await getLeadForUser({ db: opts.db, appId: app.config.appId, userId: request.user.id })
      if (!request.user.isAnonymousLead && (!existingLead || existingLead.status !== 'anonymous')) {
        reply.status(409).type('text/html')
        return '<!doctype html><title>Already signed in</title><p>You are already signed in. Open this outreach link in a private window, or sign out before opening it.</p>'
      }
      const consumed = await consumeOutreachForUser({
        db: opts.db,
        appId: app.config.appId,
        authSecret: app.config.auth.secret,
        token,
        userId: request.user.id,
        provisioner,
        creditGrantStore: opts.creditGrantStore,
      })
      reply.redirect(consumed.targetPath)
      return
    }

    await findValidOutreachLink({
      db: opts.db,
      appId: app.config.appId,
      authSecret: app.config.auth.secret,
      token,
    })

    const anonymous = await signInAnonymous(app, sessionHeaders)
    const consumed = await consumeOutreachForUser({
      db: opts.db,
      appId: app.config.appId,
      authSecret: app.config.auth.secret,
      token,
      userId: anonymous.userId,
      provisioner,
      creditGrantStore: opts.creditGrantStore,
    })
    setResponseCookies(reply, anonymous.response)
    reply.redirect(consumed.targetPath)
  })
}

export const registerOutreachRoutes = fp(outreachRoutesPlugin, { name: 'outreach-routes' })
