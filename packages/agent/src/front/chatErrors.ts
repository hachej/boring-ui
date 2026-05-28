/**
 * Turn whatever AI SDK dumped into error.message into something readable.
 * We try three shapes:
 *   1) raw text (just return it)
 *   2) JSON with { error: { code, message, field? } } — our Fastify shape
 *   3) JSON with { message: … } — AI SDK's generic server-error response
 *
 * Also maps the known validation error codes to friendlier copy.
 */
export interface FriendlyError {
  title: string
  detail?: string
  code?: string
}

export function friendlyError(err: Error): FriendlyError {
  const raw = err.message ?? ''
  // Non-JSON error (network, etc.)
  if (!raw.startsWith('{')) {
    return { title: raw || 'Something went wrong.' }
  }
  try {
    const parsed = JSON.parse(raw)
    const inner = parsed?.error ?? parsed
    const code = typeof inner?.code === 'string' ? inner.code : undefined
    const message = typeof inner?.message === 'string' ? inner.message : undefined
    const field = typeof inner?.field === 'string' ? inner.field : undefined

    if (code === 'validation_error') {
      const label = field ? `\`${field}\`` : 'the request'
      return {
        title: 'Your message couldn’t be sent.',
        detail: `${label} ${message?.toLowerCase() ?? 'failed validation'}.`,
      }
    }
    if (code === 'AGENT_RUNTIME_NOT_READY') {
      return {
        title: 'Preparing agent…',
        detail: 'Your message is still in the composer. Try again in a moment.',
        code,
      }
    }
    if (code === 'RUNTIME_PROVISIONING_FAILED') {
      return {
        title: 'Unable to prepare agent.',
        detail: message ?? 'Reload the workspace and try again.',
        code,
      }
    }
    if (code === 'internal' || code === 'internal_error') {
      return { title: 'The server hit an internal error.', detail: message, code }
    }
    return { title: message ?? 'Something went wrong.', detail: code, code }
  } catch {
    return { title: raw }
  }
}
