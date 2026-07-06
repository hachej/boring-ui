export interface LogFields {
  [key: string]: unknown
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
}

const SENSITIVE_KEYS = new Set([
  "apiKey",
  "api_key",
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "oidcToken",
  "accessToken",
  "refreshToken",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_TEAM_ID",
].map((key) => key.toLowerCase()))

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase())
}

function redactValue(key: string | undefined, value: unknown, seen: WeakSet<object>): unknown {
  if (key && isSensitiveKey(key) && value != null) return "***"
  if (value == null || typeof value !== "object") return value
  if (value instanceof Date) return value
  if (seen.has(value)) return "[Circular]"
  seen.add(value)

  if (Array.isArray(value)) {
    const out = value.map((item) => redactValue(undefined, item, seen))
    seen.delete(value)
    return out
  }

  const out: LogFields = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = redactValue(childKey, childValue, seen)
  }
  seen.delete(value)
  return out
}

function redact(fields: LogFields): LogFields {
  const out: LogFields = {}
  const seen = new WeakSet<object>()
  for (const [k, v] of Object.entries(fields)) {
    out[k] = redactValue(k, v, seen)
  }
  return out
}

function isVerbose(): boolean {
  return typeof process !== "undefined" && process.env?.BORING_AGENT_VERBOSE === "1"
}

export function createLogger(prefix: string): Logger {
  function emit(level: string, msg: string, fields?: LogFields) {
    const entry = {
      level,
      prefix,
      msg,
      ...(fields ? redact(fields) : {}),
      t: new Date().toISOString(),
    }
    if (level === "error") {
      console.error(JSON.stringify(entry))
    } else if (level === "warn") {
      console.warn(JSON.stringify(entry))
    } else {
      console.log(JSON.stringify(entry))
    }
  }

  return {
    debug(msg, fields?) {
      if (isVerbose()) emit("debug", msg, fields)
    },
    info(msg, fields?) {
      emit("info", msg, fields)
    },
    warn(msg, fields?) {
      emit("warn", msg, fields)
    },
    error(msg, fields?) {
      emit("error", msg, fields)
    },
  }
}
