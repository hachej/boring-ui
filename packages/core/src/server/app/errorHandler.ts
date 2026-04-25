import type { FastifyInstance, FastifyError } from 'fastify'
import { HttpError } from '../../shared/errors.js'

export function registerErrorHandler(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: 'Not found',
      code: 'not_found',
      message: `Route ${request.method}:${request.url} not found`,
      requestId: request.id,
    })
  })

  app.setErrorHandler((error: FastifyError | HttpError | Error, request, reply) => {
    const requestId = request.id

    if (error instanceof HttpError) {
      return reply.status(error.status).send({
        error: error.message,
        code: error.code,
        message: error.message,
        requestId,
      })
    }

    if (isValidationError(error)) {
      const firstIssue = extractFirstValidationMessage(error)
      return reply.status(400).send({
        error: 'validation_failed',
        code: 'validation_failed',
        message: firstIssue,
        requestId,
      })
    }

    if (isRateLimitError(error)) {
      const retryAfter = (error as FastifyError & { retryAfter?: number }).retryAfter ?? 60
      reply.header('Retry-After', String(retryAfter))
      return reply.status(429).send({
        error: 'rate_limited',
        code: 'rate_limited',
        message: `Too many requests. Retry after ${retryAfter} seconds.`,
        requestId,
      })
    }

    const fastifyErr = error as FastifyError
    if (fastifyErr.statusCode && fastifyErr.statusCode >= 400 && fastifyErr.statusCode < 500) {
      const code = fastifyErr.code
        ? fastifyErr.code.toLowerCase().replace(/^fst_err_/, '')
        : `http_${fastifyErr.statusCode}`
      return reply.status(fastifyErr.statusCode).send({
        error: fastifyErr.message,
        code,
        message: fastifyErr.message,
        requestId,
      })
    }

    request.log.error({ err: error, requestId }, 'unhandled error')

    return reply.status(500).send({
      error: 'internal_error',
      code: 'internal_error',
      message: 'Internal server error',
      requestId,
    })
  })
}

function isValidationError(error: unknown): boolean {
  const err = error as FastifyError
  if (err.validation) return true
  if (err.code === 'FST_ERR_VALIDATION') return true
  return false
}

function isRateLimitError(error: unknown): boolean {
  const err = error as FastifyError
  return err.statusCode === 429 || err.code === 'FST_ERR_RATE_LIMIT'
}

function extractFirstValidationMessage(error: unknown): string {
  const err = error as FastifyError & { validation?: Array<{ message?: string; params?: { issue?: string }; instancePath?: string }> }
  if (err.validation && err.validation.length > 0) {
    const first = err.validation[0]
    const path = first.instancePath ?? ''
    const msg = first.message ?? first.params?.issue ?? 'Invalid value'
    return path ? `${path}: ${msg}` : msg
  }
  return (error as Error).message || 'Validation failed'
}
