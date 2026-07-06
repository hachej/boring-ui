import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import type { Database } from '../db/connection.js'
import type { WorkspaceStore } from '../app/types.js'
import {
  outreachExperiences,
  outreachLeads,
  outreachLinks,
  workspaces,
} from '../db/schema.js'
import { ERROR_CODES, HttpError } from '../../shared/errors.js'
import { normalizeOutreachTargetPath, resolveWorkspaceTargetPath } from '../../shared/outreach/paths.js'
import { buildOutreachUrl, generateOutreachToken, hashOutreachToken } from './tokens.js'
import type { ExperienceProvisioner, OutreachExperience, ProvisionedExperience } from './types.js'

export interface OutreachCreditGrantStore {
  grantOnce(input: { userId: string; reason: string; amountMicros: number }): Promise<{ created: boolean }>
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null
  return typeof value === 'string' ? value : value.toISOString()
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function toExperience(row: typeof outreachExperiences.$inferSelect): OutreachExperience {
  return {
    id: row.id,
    appId: row.appId,
    name: row.name,
    provisioningMode: row.provisioningMode as OutreachExperience['provisioningMode'],
    templateWorkspaceId: row.templateWorkspaceId,
    defaultTargetPath: row.defaultTargetPath,
    anonymousCapabilityProfile: row.anonymousCapabilityProfile,
    config: asRecord(row.config),
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  }
}

export class DefaultExperienceProvisioner implements ExperienceProvisioner {
  constructor(
    private readonly db: Database,
    private readonly workspaceStore: WorkspaceStore,
  ) {}

  async provisionLeadExperience(input: {
    appId: string
    experienceId: string
    leadId: string
    userId: string
  }): Promise<ProvisionedExperience> {
    const existing = await this.db
      .select()
      .from(outreachLeads)
      .where(eq(outreachLeads.id, input.leadId))
      .limit(1)

    const existingLead = existing[0]
    if (existingLead?.provisionedWorkspaceId && existingLead.provisionedTargetPath) {
      return {
        workspaceId: existingLead.provisionedWorkspaceId,
        targetPath: existingLead.provisionedTargetPath,
      }
    }

    const rows = await this.db
      .select({ experience: outreachExperiences })
      .from(outreachExperiences)
      .where(and(eq(outreachExperiences.id, input.experienceId), eq(outreachExperiences.appId, input.appId)))
      .limit(1)
    const experience = rows[0]?.experience
    if (!experience) {
      throw new HttpError({
        status: 404,
        code: ERROR_CODES.NOT_FOUND,
        message: 'Outreach experience not found',
      })
    }

    if (!experience.templateWorkspaceId) {
      throw new HttpError({
        status: 400,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Outreach experience requires a template workspace for MVP provisioning',
      })
    }

    const workspaceRows = await this.db
      .select({ id: workspaces.id, appId: workspaces.appId })
      .from(workspaces)
      .where(and(
        eq(workspaces.id, experience.templateWorkspaceId),
        eq(workspaces.appId, input.appId),
        isNull(workspaces.deletedAt),
      ))
      .limit(1)
    const workspace = workspaceRows[0]
    if (!workspace) {
      throw new HttpError({
        status: 404,
        code: ERROR_CODES.NOT_FOUND,
        message: 'Outreach template workspace not found',
      })
    }

    if (experience.provisioningMode === 'clone_per_lead') {
      throw new HttpError({
        status: 501,
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'clone_per_lead outreach provisioning is not implemented yet',
      })
    }

    await this.workspaceStore.upsertMember(workspace.id, input.userId, 'viewer')

    return {
      workspaceId: workspace.id,
      targetPath: resolveWorkspaceTargetPath(experience.defaultTargetPath, workspace.id),
    }
  }
}

export async function createOutreachExperience(input: {
  db: Database
  appId: string
  name: string
  provisioningMode: 'shared_readonly' | 'existing_workspace_viewer' | 'clone_per_lead'
  templateWorkspaceId?: string | null
  defaultTargetPath: string
  anonymousCapabilityProfile?: string
  config?: Record<string, unknown>
  createdBy: string | null
}): Promise<OutreachExperience> {
  normalizeOutreachTargetPath(input.defaultTargetPath)

  if (input.provisioningMode === 'clone_per_lead') {
    throw new HttpError({
      status: 400,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: 'clone_per_lead outreach provisioning is not implemented yet',
    })
  }

  if (input.templateWorkspaceId) {
    const rows = await input.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(
        eq(workspaces.id, input.templateWorkspaceId),
        eq(workspaces.appId, input.appId),
        isNull(workspaces.deletedAt),
      ))
      .limit(1)
    if (!rows[0]) {
      throw new HttpError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: 'Template workspace not found' })
    }
  }

  const [row] = await input.db
    .insert(outreachExperiences)
    .values({
      appId: input.appId,
      name: input.name,
      provisioningMode: input.provisioningMode,
      templateWorkspaceId: input.templateWorkspaceId ?? null,
      defaultTargetPath: input.defaultTargetPath,
      anonymousCapabilityProfile: input.anonymousCapabilityProfile ?? 'trial',
      config: input.config ?? {},
      createdBy: input.createdBy,
    })
    .returning()

  return toExperience(row)
}

export async function createOutreachLink(input: {
  db: Database
  appId: string
  authSecret: string
  authUrl: string
  experienceId: string
  campaignId?: string | null
  recipientHint?: string | null
  ttlHours?: number
  maxLeads?: number | null
  initialCreditMicros?: number
  maxInitialCreditMicros?: number
  createdBy: string | null
}): Promise<{ url: string; expiresAt: string; id: string }> {
  const experienceRows = await input.db
    .select({ id: outreachExperiences.id, provisioningMode: outreachExperiences.provisioningMode })
    .from(outreachExperiences)
    .where(and(eq(outreachExperiences.id, input.experienceId), eq(outreachExperiences.appId, input.appId)))
    .limit(1)
  const experience = experienceRows[0]
  if (!experience) {
    throw new HttpError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: 'Outreach experience not found' })
  }
  if (experience.provisioningMode === 'clone_per_lead') {
    throw new HttpError({
      status: 400,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: 'clone_per_lead outreach provisioning is not implemented yet',
    })
  }

  const initialCreditMicros = input.initialCreditMicros ?? 0
  const maxInitialCreditMicros = input.maxInitialCreditMicros ?? 10_000_000
  if (!Number.isSafeInteger(maxInitialCreditMicros) || maxInitialCreditMicros < 0) {
    throw new HttpError({ status: 500, code: ERROR_CODES.INTERNAL_ERROR, message: 'maxInitialCreditMicros must be a non-negative safe integer' })
  }
  if (!Number.isSafeInteger(initialCreditMicros) || initialCreditMicros < 0) {
    throw new HttpError({ status: 400, code: ERROR_CODES.VALIDATION_FAILED, message: 'initialCreditMicros must be a non-negative safe integer' })
  }
  if (initialCreditMicros > maxInitialCreditMicros) {
    throw new HttpError({ status: 400, code: ERROR_CODES.VALIDATION_FAILED, message: `initialCreditMicros must be <= ${maxInitialCreditMicros}` })
  }

  const rawToken = generateOutreachToken()
  const tokenHash = hashOutreachToken(rawToken, input.authSecret)
  const expiresAt = new Date(Date.now() + (input.ttlHours ?? 24 * 30) * 60 * 60 * 1000)
  const [row] = await input.db
    .insert(outreachLinks)
    .values({
      appId: input.appId,
      experienceId: input.experienceId,
      campaignId: input.campaignId ?? null,
      tokenHash,
      recipientHint: input.recipientHint ?? null,
      expiresAt,
      maxLeads: input.maxLeads ?? null,
      initialCreditMicros,
      createdBy: input.createdBy,
    })
    .returning({ id: outreachLinks.id, expiresAt: outreachLinks.expiresAt })

  return {
    id: row.id,
    url: buildOutreachUrl(input.authUrl, rawToken),
    expiresAt: toIso(row.expiresAt)!,
  }
}

export async function findValidOutreachLink(input: {
  db: Database
  appId: string
  authSecret: string
  token: string
  enforceCapacity?: boolean
}): Promise<{ link: typeof outreachLinks.$inferSelect; experience: typeof outreachExperiences.$inferSelect }> {
  const tokenHash = hashOutreachToken(input.token, input.authSecret)
  const conditions = [
    eq(outreachLinks.tokenHash, tokenHash),
    eq(outreachLinks.appId, input.appId),
    eq(outreachExperiences.appId, input.appId),
    isNull(outreachLinks.revokedAt),
    gt(outreachLinks.expiresAt, new Date()),
  ]
  if (input.enforceCapacity !== false) {
    conditions.push(or(isNull(outreachLinks.maxLeads), sql`${outreachLinks.leadCount} < ${outreachLinks.maxLeads}`)!)
  }
  const rows = await input.db
    .select({ link: outreachLinks, experience: outreachExperiences })
    .from(outreachLinks)
    .innerJoin(outreachExperiences, eq(outreachLinks.experienceId, outreachExperiences.id))
    .where(and(...conditions))
    .limit(1)

  const row = rows[0]
  if (!row) {
    throw new HttpError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: 'Outreach link is invalid or expired' })
  }
  return row
}

export async function getLeadForUser(input: {
  db: Database
  appId: string
  userId: string
}): Promise<typeof outreachLeads.$inferSelect | null> {
  const existing = await input.db
    .select()
    .from(outreachLeads)
    .where(and(eq(outreachLeads.appId, input.appId), eq(outreachLeads.userId, input.userId)))
    .limit(1)
  return existing[0] ?? null
}

export async function createLeadForUser(input: {
  db: Database
  appId: string
  linkId: string
  userId: string
}): Promise<typeof outreachLeads.$inferSelect> {
  const existing = await getLeadForUser({ db: input.db, appId: input.appId, userId: input.userId })
  if (existing) return existing

  return input.db.transaction(async (tx) => {
    const [lead] = await tx
      .insert(outreachLeads)
      .values({
        appId: input.appId,
        outreachLinkId: input.linkId,
        userId: input.userId,
        provisioningStatus: 'pending',
        status: 'anonymous',
      })
      .onConflictDoNothing({ target: outreachLeads.userId })
      .returning()

    if (!lead) {
      const rows = await tx
        .select()
        .from(outreachLeads)
        .where(and(eq(outreachLeads.appId, input.appId), eq(outreachLeads.userId, input.userId)))
        .limit(1)
      if (rows[0]) {
        if (rows[0].outreachLinkId !== input.linkId) {
          throw new HttpError({
            status: 409,
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'Anonymous session belongs to a different outreach link',
          })
        }
        return rows[0]
      }
      throw new HttpError({ status: 409, code: ERROR_CODES.VALIDATION_FAILED, message: 'Outreach lead already exists' })
    }

    const [reserved] = await tx
      .update(outreachLinks)
      .set({
        leadCount: sql`${outreachLinks.leadCount} + 1`,
        firstOpenedAt: sql`COALESCE(${outreachLinks.firstOpenedAt}, now())`,
        lastOpenedAt: new Date(),
      })
      .where(and(
        eq(outreachLinks.id, input.linkId),
        eq(outreachLinks.appId, input.appId),
        isNull(outreachLinks.revokedAt),
        gt(outreachLinks.expiresAt, new Date()),
        or(isNull(outreachLinks.maxLeads), sql`${outreachLinks.leadCount} < ${outreachLinks.maxLeads}`),
      ))
      .returning({ id: outreachLinks.id })

    if (!reserved) {
      throw new HttpError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: 'Outreach link is invalid or exhausted' })
    }

    return lead
  })
}

export async function provisionLeadWithState(input: {
  db: Database
  provisioner: ExperienceProvisioner
  appId: string
  experienceId: string
  leadId: string
  userId: string
}): Promise<ProvisionedExperience> {
  const existing = await input.db
    .select()
    .from(outreachLeads)
    .where(eq(outreachLeads.id, input.leadId))
    .limit(1)
  const existingLead = existing[0]
  if (existingLead?.provisionedWorkspaceId && existingLead.provisionedTargetPath) {
    return { workspaceId: existingLead.provisionedWorkspaceId, targetPath: existingLead.provisionedTargetPath }
  }

  const [claimed] = await input.db
    .update(outreachLeads)
    .set({
      provisioningStatus: 'provisioning',
      provisioningAttemptedAt: new Date(),
      provisioningErrorCode: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(outreachLeads.id, input.leadId),
      or(eq(outreachLeads.provisioningStatus, 'pending'), eq(outreachLeads.provisioningStatus, 'failed')),
    ))
    .returning({ id: outreachLeads.id })

  if (!claimed) {
    const current = await input.db
      .select()
      .from(outreachLeads)
      .where(eq(outreachLeads.id, input.leadId))
      .limit(1)
    if (current[0]?.provisionedWorkspaceId && current[0].provisionedTargetPath) {
      return { workspaceId: current[0].provisionedWorkspaceId, targetPath: current[0].provisionedTargetPath }
    }
    throw new HttpError({ status: 409, code: ERROR_CODES.VALIDATION_FAILED, message: 'Outreach lead is already provisioning' })
  }

  try {
    const result = await input.provisioner.provisionLeadExperience({
      appId: input.appId,
      experienceId: input.experienceId,
      leadId: input.leadId,
      userId: input.userId,
    })
    await attachProvisionResult({ db: input.db, leadId: input.leadId, result })
    return result
  } catch (error) {
    await input.db
      .update(outreachLeads)
      .set({
        provisioningStatus: 'failed',
        provisioningErrorCode: error instanceof HttpError ? error.code : ERROR_CODES.INTERNAL_ERROR,
        updatedAt: new Date(),
      })
      .where(eq(outreachLeads.id, input.leadId))
    throw error
  }
}

export async function consumeOutreachForUser(input: {
  db: Database
  appId: string
  authSecret: string
  token: string
  userId: string
  provisioner: ExperienceProvisioner
  creditGrantStore: OutreachCreditGrantStore
}): Promise<{ targetPath: string; leadId: string }> {
  const existingLead = await getLeadForUser({ db: input.db, appId: input.appId, userId: input.userId })
  const { link } = await findValidOutreachLink({
    db: input.db,
    appId: input.appId,
    authSecret: input.authSecret,
    token: input.token,
    enforceCapacity: !existingLead,
  })

  if (existingLead && existingLead.status === 'anonymous' && existingLead.outreachLinkId !== link.id) {
    throw new HttpError({
      status: 409,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: 'Anonymous session belongs to a different outreach link',
    })
  }

  const lead = existingLead ?? await createLeadForUser({
    db: input.db,
    appId: input.appId,
    linkId: link.id,
    userId: input.userId,
  })
  const result = await provisionLeadWithState({
    db: input.db,
    provisioner: input.provisioner,
    appId: input.appId,
    experienceId: link.experienceId,
    leadId: lead.id,
    userId: input.userId,
  })
  if (link.initialCreditMicros > 0) {
    await input.creditGrantStore.grantOnce({ 
      userId: input.userId,
      reason: `outreach:${link.id}:initial_credit`,
      amountMicros: link.initialCreditMicros,
    })
  }
  return { targetPath: result.targetPath, leadId: lead.id }
}

export async function attachProvisionResult(input: {
  db: Database
  leadId: string
  result: ProvisionedExperience
}): Promise<void> {
  await input.db
    .update(outreachLeads)
    .set({
      provisionedWorkspaceId: input.result.workspaceId,
      provisionedTargetPath: input.result.targetPath,
      provisionResult: input.result,
      provisioningStatus: 'provisioned',
      provisioningCompletedAt: new Date(),
      provisioningErrorCode: null,
      updatedAt: new Date(),
    })
    .where(eq(outreachLeads.id, input.leadId))
}
