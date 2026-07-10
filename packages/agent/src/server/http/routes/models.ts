/**
 * GET /api/v1/agent/models
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
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent'
import {
  readConfiguredDefaultModel,
  registerConfiguredModelProviders,
  type AgentModelSelection,
} from '../../models/modelConfig.js'

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

export interface ModelFilterContext {
  request: FastifyRequest
  workspaceId?: string
}

export type ModelFilterResult = {
  models: readonly ModelSummary[]
  defaultModel?: AgentModelSelection
}

export interface ModelsRoutesOptions {
  /** Read host env/Pi settings to choose a default model. Disable for pure profiles. */
  allowConfiguredDefaultModel?: boolean
  filterModels?: (
    ctx: ModelFilterContext,
    models: readonly ModelSummary[],
    defaultModel: AgentModelSelection | undefined,
  ) => ModelFilterResult | Promise<ModelFilterResult>
}

export function modelsRoutes(
  app: FastifyInstance,
  opts: ModelsRoutesOptions,
  done: (err?: Error) => void,
): void {
  // Build one registry per process — reads env + ~/.pi/agent/auth.json.
  // Cached so repeated GETs don't re-scan auth every request.
  const authStorage = AuthStorage.create()
  const registry = ModelRegistry.create(authStorage)
  const configuredModels = registerConfiguredModelProviders(registry)
  const configuredModelSet = new Set(
    configuredModels.map((model) => `${model.provider}:${model.id}`),
  )
  app.get('/api/v1/agent/models', async (request, reply) => {
    const availableModels = registry.getAvailable()
    const availableSet = new Set(
      availableModels.map((m) => `${m.provider}:${m.id}`),
    )
    const allModels = configuredModelSet.size > 0
      ? registry.getAll().filter((m) => configuredModelSet.has(`${m.provider}:${m.id}`))
      : registry.getAll()
    const models: ModelSummary[] = allModels.map((m) => ({
      provider: m.provider,
      id: m.id,
      label: (m as unknown as { label?: string }).label ?? m.id,
      // Keep this endpoint cheap: it is fetched on chat mount, so it must never
      // block workspace load on deep provider auth resolution. ModelRegistry's
      // available set is already derived from configured auth sources. When
      // hosts configure launch/custom providers, those configured models are an
      // allowlist: do not leak the built-in registry's unavailable catalog.
      available: availableSet.has(`${m.provider}:${m.id}`),
    }))
    // Stable order: available first, then alphabetically by (provider, id).
    models.sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
      return a.id.localeCompare(b.id)
    })
    const configuredDefaultModel = opts.allowConfiguredDefaultModel === false
      ? undefined
      : readConfiguredDefaultModel()
    const defaultModel = configuredDefaultModel
      && models.some((m) => m.available && m.provider === configuredDefaultModel.provider && m.id === configuredDefaultModel.id)
      ? configuredDefaultModel
      : undefined
    const filtered = opts.filterModels
      ? await opts.filterModels(
        { request, workspaceId: request.workspaceContext?.workspaceId },
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

  done()
}
