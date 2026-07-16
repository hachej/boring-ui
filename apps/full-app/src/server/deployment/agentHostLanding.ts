import type { CoreFrontendRootHandler } from '@hachej/boring-core/app/server'

import type { AgentHostActiveCollectionReader } from './activeCollectionReader.js'
import { AgentHostErrorCode, type AgentHostSiteBindingV1 } from './agentHostPlan.js'

const SIGN_IN_PATH = '/auth/signin?redirect=%2F'

export interface AgentHostLandingOptions {
  readonly activeReader: AgentHostActiveCollectionReader
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

function validText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\0-\x1f\x7f]/.test(value)
}

function renderLanding(binding: AgentHostSiteBindingV1): string | null {
  const { title, summary, ctaLabel } = binding.landing
  if (!validText(title, 120) || !validText(summary, 500) || (ctaLabel !== undefined && !validText(ctaLabel, 80))) return null
  const cta = escapeHtml(ctaLabel ?? 'Sign in')
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
    + `${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(summary)}</p>`
    + `<a href="${SIGN_IN_PATH}">${cta}</a></main></body></html>`
}

function unavailable(reply: Parameters<CoreFrontendRootHandler>[1]): true {
  const code = AgentHostErrorCode.COLLECTION_NOT_READY
  reply.status(503).header('cache-control', 'no-store').send({ error: code, code, message: code })
  return true
}

export function createAgentHostLandingRootHandler(options: AgentHostLandingOptions): CoreFrontendRootHandler {
  return async (request, reply) => {
    if (request.user) return false
    const scope = request.requestScope
    if (!scope) return unavailable(reply)
    let collection
    try { collection = await options.activeReader.read() } catch { return unavailable(reply) }
    if (!collection || collection.active.revisionId !== scope.activeRevision) return unavailable(reply)
    const matches = collection.desired.plan.bindings.filter((binding) => binding.bindingId === scope.bindingId)
    if (matches.length !== 1) return unavailable(reply)
    const binding = matches[0]!
    if (binding.workspaceId !== scope.workspaceId || binding.defaultDeploymentId !== scope.defaultDeploymentId) return unavailable(reply)
    const html = renderLanding(binding)
    if (html === null) return unavailable(reply)
    reply.header('cache-control', 'no-store').type('text/html; charset=utf-8').send(html)
    return true
  }
}
