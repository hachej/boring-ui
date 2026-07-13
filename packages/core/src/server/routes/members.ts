import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { HttpError, ERROR_CODES } from '../../shared/errors.js'
import { requireWorkspaceMember } from '../auth/requireWorkspaceMember.js'
import { addMemberBody, updateRoleBody } from './__schemas__/members.js'

const memberRoutesPlugin: FastifyPluginAsync = async (app) => {
  const store = app.workspaceStore

  app.get(
    '/api/v1/workspaces/:id/members',
    { preHandler: requireWorkspaceMember() },
    async (request) => {
      const { id } = request.params as { id: string }
      const members = await store.listMembers(id)
      return { members }
    },
  )

  app.post(
    '/api/v1/workspaces/:id/members',
    { preHandler: requireWorkspaceMember('owner') },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const parsed = addMemberBody.safeParse(request.body)
      if (!parsed.success) {
        throw new HttpError({
          status: 400,
          code: ERROR_CODES.VALIDATION_FAILED,
          message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          requestId: request.id,
        })
      }

      const existing = request.requestScope ? null : await store.getMemberRole(id, parsed.data.userId)
      const member = request.requestScope
        ? await store.createMemberIfAbsent(id, parsed.data.userId, parsed.data.role)
        : existing ? null : await store.upsertMember(id, parsed.data.userId, parsed.data.role)
      if (!member) {
        throw new HttpError({
          status: 409,
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'User is already a member of this workspace',
          requestId: request.id,
        })
      }

      reply.status(201)
      return { member }
    },
  )

  app.patch(
    '/api/v1/workspaces/:id/members/:userId/role',
    { preHandler: requireWorkspaceMember('owner') },
    async (request) => {
      const { id, userId } = request.params as { id: string; userId: string }
      const parsed = updateRoleBody.safeParse(request.body)
      if (!parsed.success) {
        throw new HttpError({
          status: 400,
          code: ERROR_CODES.VALIDATION_FAILED,
          message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          requestId: request.id,
        })
      }

      const result = await store.updateMemberRole(id, userId, parsed.data.role, request.requestScope
        ? { forbidExistingOwnerMutation: true }
        : undefined)

      if (result.member) {
        return { member: result.member }
      }

      if (result.code === ERROR_CODES.LAST_OWNER) {
        throw new HttpError({
          status: 409,
          code: ERROR_CODES.LAST_OWNER,
          message: 'Cannot demote the last owner',
          requestId: request.id,
        })
      }

      if (result.code === ERROR_CODES.NOT_MEMBER) {
        throw new HttpError({
          status: 404,
          code: ERROR_CODES.NOT_MEMBER,
          message: 'User is not a member of this workspace',
          requestId: request.id,
        })
      }

      if (result.code === ERROR_CODES.D1_MANAGED_WORKSPACE_MUTATION_FORBIDDEN) {
        throw new HttpError({
          status: 403,
          code: result.code,
          message: result.code,
          requestId: request.id,
        })
      }

      throw new HttpError({
        status: 500,
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Unexpected error updating role',
        requestId: request.id,
      })
    },
  )

  app.delete(
    '/api/v1/workspaces/:id/members/:userId',
    { preHandler: requireWorkspaceMember() },
    async (request) => {
      const { id, userId } = request.params as { id: string; userId: string }
      const isSelfRemoval = request.user?.id === userId

      if (!isSelfRemoval) {
        const callerRole = await store.getMemberRole(id, request.user!.id)
        if (callerRole !== 'owner') {
          throw new HttpError({
            status: 403,
            code: ERROR_CODES.FORBIDDEN,
            message: 'Only owners can remove other members',
            requestId: request.id,
          })
        }
      }

      const result = await store.removeMember(id, userId, request.requestScope
        ? { forbidExistingOwnerMutation: true }
        : undefined)

      if (result.removed) {
        return { removed: true }
      }

      if (result.code === ERROR_CODES.LAST_OWNER) {
        throw new HttpError({
          status: 409,
          code: ERROR_CODES.LAST_OWNER,
          message: 'Cannot remove the last owner',
          requestId: request.id,
        })
      }

      if (result.code === ERROR_CODES.NOT_MEMBER) {
        throw new HttpError({
          status: 404,
          code: ERROR_CODES.NOT_MEMBER,
          message: 'User is not a member of this workspace',
          requestId: request.id,
        })
      }

      if (result.code === ERROR_CODES.D1_MANAGED_WORKSPACE_MUTATION_FORBIDDEN) {
        throw new HttpError({
          status: 403,
          code: result.code,
          message: result.code,
          requestId: request.id,
        })
      }

      throw new HttpError({
        status: 500,
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Unexpected error removing member',
        requestId: request.id,
      })
    },
  )
}

export const registerMemberRoutes = fp(memberRoutesPlugin, { name: 'member-routes' })
