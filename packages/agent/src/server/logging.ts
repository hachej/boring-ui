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
])

function redact(fields: LogFields): LogFields {
  const out: LogFields = {}
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE_KEYS.has(k) && typeof v === "string") {
      out[k] = "***"
    } else {
      out[k] = v
    }
  }
  return out
}

const verbose =
  typeof process !== "undefined" && process.env?.BORING_AGENT_VERBOSE === "1"

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
      if (verbose) emit("debug", msg, fields)
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
