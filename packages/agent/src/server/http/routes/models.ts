/**
 * GET /api/v1/agents/:agentTypeId/models
 *
 * Returns the list of models pi-coding-agent has auth for (i.e. where
 * the corresponding provider API key is present in the environment or
 * `~/.pi/agent/auth.json`). Consumers — including the shadcn example
 * ChatPanel — fetch this endpoint to populate the model-selector dropdown
 * instead of hardcoding a short alias list.
 *
 * Shape:
 *   {
 *     models: [
 *       { provider: "anthropic", id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", available: true },
 *       ...
 *     ]
 *   }
 *
 * Safe to call unauthenticated — we only report {provider, id, label,
 * available}, never any key material.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  readConfiguredDefaultModel,
  type AgentModelSelection,
} from '../../models/modelConfig.js'
import {
  CREDENTIAL_ERROR_CODES,
  CredentialResolutionError,
} from '../../../shared/credentials/errors.js'
import type { TrustedAgentExecutionClass } from '../../../shared/harness.js'
import { createConfiguredModelRuntime } from '../../models/modelRuntime.js'

export interface ModelSummary {
  provider: string
  id: string
  label: string
  available: boolean
}

export interface ModelsResponse {
  models: ModelSummary[]
  defaultModel?: AgentModelSelection
}

export interface VerifiedModelRequestActor {
  readonly workspaceId: string
  readonly userId: string
  readonly executionClass: TrustedAgentExecutionClass
}

export interface ModelFilterContext {
  request: FastifyRequest
  workspaceId?: string
  userId?: string
  executionClass?: TrustedAgentExecutionClass
}

export interface ModelCatalogSnapshot {
  /** Pi-free projection of the models visible to this actor. */
  readonly models: readonly ModelSummary[]
}

export type ModelCatalogResolver = (
  actor: VerifiedModelRequestActor,
) => ModelCatalogSnapshot | Promise<ModelCatalogSnapshot>

/** Keep Pi runtime objects inside the HTTP adapter; Agent Host sees only the DTO. */
function projectModelCatalog(
  catalog: Awaited<ReturnType<typeof createConfiguredModelRuntime>>,
): ModelCatalogSnapshot {
  const { modelRuntime, configuredModels } = catalog
  const configuredModelSet = new Set(
    configuredModels.map((model) => `${model.provider}:${model.id}`),
  )
  const availableSet = new Set(
    modelRuntime.getAvailableSnapshot().map((model) => `${model.provider}:${model.id}`),
  )
  const allModels = configuredModelSet.size > 0
    ? modelRuntime.getModels().filter((model) => configuredModelSet.has(`${model.provider}:${model.id}`))
    : modelRuntime.getModels()
  return {
    models: allModels.map((model) => ({
      provider: model.provider,
      id: model.id,
      label: (model as unknown as { label?: string }).label ?? model.id,
      available: availableSet.has(`${model.provider}:${model.id}`),
    })),
  }
}

export type ModelFilterResult = {
  models: readonly ModelSummary[]
  defaultModel?: AgentModelSelection
}

export interface ModelsRoutesOptions {
  path?: string
  authorizeRequest?: (
    request: FastifyRequest,
  ) => void | VerifiedModelRequestActor | Promise<void | VerifiedModelRequestActor>
  /** Actor-aware catalogs are resolved only after authorizeRequest succeeds. */
  resolveModelCatalog?: ModelCatalogResolver
  filterModels?: (
    ctx: ModelFilterContext,
    models: readonly ModelSummary[],
    defaultModel: AgentModelSelection | undefined,
  ) => ModelFilterResult | Promise<ModelFilterResult>
}

export async function modelsRoutes(
  app: FastifyInstance,
  opts: ModelsRoutesOptions,
): Promise<void> {
  // Preserve the compatibility runtime as the default. Actor-aware callers
  // resolve a catalog per authorized request and therefore construct nothing
  // actor-bound during route registration or denied authorization.
  const compatibilityCatalog = opts.resolveModelCatalog
    ? undefined
    : projectModelCatalog(await createConfiguredModelRuntime())

  app.get(opts.path ?? '/api/v1/agents/:agentTypeId/models', async (request, reply) => {
    const actor = await opts.authorizeRequest?.(request)
    if (opts.resolveModelCatalog && !actor) {
      throw new CredentialResolutionError(
        CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
        'actor-aware model catalog resolution requires a verified request actor',
      )
    }
    const catalog = opts.resolveModelCatalog
      ? await opts.resolveModelCatalog(actor as VerifiedModelRequestActor)
      : compatibilityCatalog!
    // Availability is an advisory snapshot for display. Request-auth store
    // resolution remains authoritative when a model call actually runs. Clone
    // the Pi-free snapshot because filters may mutate their input.
    const models: ModelSummary[] = catalog.models.map((model) => ({ ...model }))
    // Stable order: available first, then alphabetically by (provider, id).
    models.sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
      return a.id.localeCompare(b.id)
    })
    const configuredDefaultModel = readConfiguredDefaultModel()
    const defaultModel = configuredDefaultModel
      && models.some((m) => m.available && m.provider === configuredDefaultModel.provider && m.id === configuredDefaultModel.id)
      ? configuredDefaultModel
      : undefined
    const filtered = opts.filterModels
      ? await opts.filterModels(
        {
          request,
          workspaceId: actor?.workspaceId ?? request.workspaceContext?.workspaceId,
          ...(actor ? { userId: actor.userId, executionClass: actor.executionClass } : {}),
        },
        models.map((model) => ({ ...model })),
        defaultModel ? { provider: defaultModel.provider, id: defaultModel.id } : undefined,
      )
      : { models, defaultModel }
    const responseModels = filtered.models.map((model) => ({ ...model }))
    const fallbackDefault = responseModels.find((model) => model.available)
    const responseDefault = filtered.defaultModel
      && responseModels.some((m) => m.available && m.provider === filtered.defaultModel?.provider && m.id === filtered.defaultModel.id)
      ? { provider: filtered.defaultModel.provider, id: filtered.defaultModel.id }
      : fallbackDefault ? { provider: fallbackDefault.provider, id: fallbackDefault.id } : undefined
    const payload: ModelsResponse = responseDefault
      ? { models: responseModels, defaultModel: responseDefault }
      : { models: responseModels }
    return reply.code(200).send(payload)
  })

}
