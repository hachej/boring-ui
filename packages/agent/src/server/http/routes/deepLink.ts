// AR1-003 Lane W membership-gated `/a/<id>` deep-link route. See
// docs/issues/391/runtime-refactor/work/AR1-shareable-artifacts/AR1-001-SPEC.md
// §3.2/§3.3/§6.2 and IMPLEMENTATION-GUARDRAILS.md (AR1 section) for the
// binding contract. Consumes the AR1-002 share-entry store/resolver
// (`../../../shared/share-entry`) — this route is a thin consumer, not a
// second authority: it invents no membership check of its own (spec §3.3,
// "Access denial is the existing generic membership denial, not an AR1
// code") and never emits a workspace path in any response body.
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify'
import type { Workspace } from '../../../shared/workspace'
import {
  ShareEntryErrorCode,
  isShareTargetNotFoundError,
  resolveShareEntry,
  type ShareEntryStore,
} from '../../../shared/share-entry'

const DEFAULT_WORKSPACE_ID = 'default'

interface DeepLinkParams {
  id: string
}

export interface DeepLinkRoutesOptions {
  /** Workspace-agnostic store: entries carry their own `workspaceId`. */
  store: ShareEntryStore
  workspace?: Workspace
  /**
   * Resolves the `Workspace` only after authorizing the requester for the
   * entry's opaque workspace binding. Return `null` for an authentication or
   * membership denial so the route can make denied and unknown locators
   * externally indistinguishable; operational failures must still throw.
   */
  getWorkspace?: (request: FastifyRequest, shareWorkspaceId: string | null) => Workspace | null | Promise<Workspace | null>
}

function getRequestWorkspaceId(request: FastifyRequest): string {
  return request.workspaceContext?.workspaceId ?? DEFAULT_WORKSPACE_ID
}

/**
 * Identical outward response for "no such entry" and "entry exists but not
 * in the requester's authorized/scoped workspace". This is the "no existence
 * oracle for non-members" rule (bead AR1-003 acceptance; spec §2.11/§6.2.3:
 * "a non-member gets a clean denial, not a 404 that leaks existence
 * differently"). Never includes a path.
 */
function sendShareNotFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({
    error: { code: ShareEntryErrorCode.enum.AR1_SHARE_NOT_FOUND, message: 'share not found' },
  })
}

export const deepLinkRoutes: FastifyPluginCallback<DeepLinkRoutesOptions> = (app, opts, done) => {
  async function resolveWorkspace(request: FastifyRequest, shareWorkspaceId: string | null): Promise<Workspace | null> {
    if (opts.getWorkspace) return await opts.getWorkspace(request, shareWorkspaceId)
    if (opts.workspace) return opts.workspace
    throw new Error('deep-link route requires workspace or getWorkspace')
  }

  app.get<{ Params: DeepLinkParams }>('/a/:id', async (request, reply) => {
    const { id } = request.params

    // Lane W is same-workspace only (spec §3.1): a share entry only resolves
    // within the workspace the requester is already authorized/scoped to.
    // Look the entry up first so a workspaceId mismatch can be treated
    // identically to "no such entry" below, rather than confirming
    // cross-workspace existence to a caller not authorized for that
    // workspace.
    const entry = await opts.store.get(id)
    if (!entry) {
      // Exercise the host's authentication/authorization path even when the
      // opaque locator is unknown. Core substitutes an impossible workspace
      // id, so this performs the same authority checks without granting or
      // acquiring any Workspace.
      await resolveWorkspace(request, null)
      return sendShareNotFound(reply)
    }

    // Core uses the entry's opaque workspace binding to perform its normal
    // membership authorization and acquire that exact Workspace. Only after
    // authorization may request.workspaceContext be trusted for comparison.
    const workspace = await resolveWorkspace(request, entry.workspaceId)
    if (!workspace || entry.workspaceId !== getRequestWorkspaceId(request)) return sendShareNotFound(reply)
    const resolution = await resolveShareEntry(opts.store, id, workspace)

    switch (resolution.status) {
      case 'not_found':
        return sendShareNotFound(reply)
      case 'tombstoned':
        return reply.code(200).send({
          status: 'tombstoned',
          code: resolution.code,
          tombstone: resolution.tombstone,
        })
      case 'ok': {
        let content: string
        try {
          content = await workspace.readFile(resolution.entry.path)
        } catch (error) {
          if (!isShareTargetNotFoundError(error)) throw error
          return reply.code(200).send({
            status: 'tombstoned',
            code: ShareEntryErrorCode.enum.AR1_SHARE_TOMBSTONED,
            tombstone: {
              id: resolution.entry.id,
              workspaceId: resolution.entry.workspaceId,
              provenance: resolution.entry.provenance,
            },
          })
        }
        // A share opens the live file as a safe attachment. Serving agent-authored
        // HTML inline at the application origin would create a stored-XSS boundary.
        return reply
          .header('content-type', 'application/octet-stream')
          .header('content-disposition', `attachment; filename="${downloadFilename(resolution.entry.path)}"`)
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', "sandbox; default-src 'none'")
          .code(200)
          .send(content)
      }
    }
  })

  done()
}

function downloadFilename(path: string): string {
  const match = /\.(html?|md|json|txt)$/i.exec(path)
  const extension = match?.[1]?.toLowerCase() ?? 'txt'
  return `artifact.${extension}`
}
