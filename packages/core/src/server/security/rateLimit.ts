import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify'
import rateLimit from '@fastify/rate-limit'

interface RateLimitRule {
  endpoint: string
  url: string
  method: 'POST' | 'GET'
  max: number
  timeWindow: string
  keyGenerator?: (req: FastifyRequest) => string
}

export const DEFAULT_RATE_LIMIT_RULES: readonly RateLimitRule[] = [
  {
    endpoint: '/auth/sign-in/email',
    url: '/auth/sign-in/email',
    method: 'POST',
    max: 5,
    timeWindow: '1 minute',
  },
  {
    endpoint: '/auth/sign-up/email',
    url: '/auth/sign-up/email',
    method: 'POST',
    max: 3,
    timeWindow: '1 hour',
  },
  {
    endpoint: '/auth/forget-password',
    url: '/auth/forget-password',
    method: 'POST',
    max: 3,
    timeWindow: '1 hour',
  },
  {
    endpoint: '/auth/send-verification-email',
    url: '/auth/send-verification-email',
    method: 'POST',
    max: 3,
    timeWindow: '1 hour',
  },
  {
    // Override key uses the templated route string, not a concrete workspace ID.
    endpoint: '/api/v1/workspaces/:id/invites',
    url: '/api/v1/workspaces/:id/invites',
    method: 'POST',
    max: 20,
    timeWindow: '1 hour',
    keyGenerator: (req) => {
      const workspaceId = (req.params as Record<string, string>).id ?? 'unknown'
      return workspaceId
    },
  },
]

function matchesRule(
  routeOptions: RouteOptions,
  rule: RateLimitRule,
): boolean {
  if (routeOptions.url !== rule.url) return false
  const methods = Array.isArray(routeOptions.method)
    ? routeOptions.method
    : [routeOptions.method]
  return methods.some((m) => m.toUpperCase() === rule.method)
}

function resolveRule(
  rule: RateLimitRule,
  overrides?: Record<string, { max: number; window: string }>,
): RateLimitRule {
  if (!overrides) return rule

  const byMethodAndPath = overrides[`${rule.method} ${rule.endpoint}`]
  const byPath = overrides[rule.endpoint]
  const override = byMethodAndPath ?? byPath
  if (!override) return rule

  return {
    ...rule,
    max: override.max,
    timeWindow: override.window,
  }
}

export async function registerRateLimits(app: FastifyInstance) {
  const overrides = app.config.rateLimit

  app.addHook('onRoute', (routeOptions) => {
    const baseRule = DEFAULT_RATE_LIMIT_RULES.find((r) =>
      matchesRule(routeOptions, r),
    )
    if (!baseRule) return
    const rule = resolveRule(baseRule, overrides)

    routeOptions.config = {
      ...routeOptions.config,
      rateLimit: {
        max: rule.max,
        timeWindow: rule.timeWindow,
        ...(rule.keyGenerator ? { keyGenerator: rule.keyGenerator } : {}),
      },
    }
  })

  await app.register(rateLimit, { global: false })
}
