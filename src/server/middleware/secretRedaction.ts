/**
 * Secret redaction for structured logging.
 * Prevents secrets from appearing in log output.
 */

const REDACTED = '[REDACTED]'
const SECRET_PATTERNS = [
  /boring_session[^=]*=([^;]+)/gi,
  /authorization:\s*bearer\s+(\S+)/gi,
  /password['":\s]+([^'",\s]+)/gi,
  /secret['":\s]+([^'",\s]+)/gi,
  /api[_-]?key['":\s]+([^'",\s]+)/gi,
  /database[_-]?url['":\s]+([^'",\s]+)/gi,
  /postgres(ql)?:\/\/[^\s]+/gi,
]

/**
 * Pino serializer that redacts sensitive values.
 */
export function redactSecrets(value: unknown): unknown {
  if (typeof value !== 'string') return value
  let result = value
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match) => {
      return match.replace(/=.+|:\s*.+/, `=${REDACTED}`)
    })
  }
  return result
}

/**
 * Pino redaction paths for structured log fields.
 */
export const PINO_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
]
