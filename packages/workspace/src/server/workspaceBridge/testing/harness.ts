import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  type BridgeActorAttribution,
  type BridgeAuthContext,
  type BridgeCallerClass,
  type WorkspaceBridgeFileAssetPointer,
  type WorkspaceBridgeOperationDefinition,
} from "../../../shared/workspace-bridge-rpc"

export const BRIDGE_TEST_REDACTION = "[REDACTED]"

export interface TestRuntimeTokenClaims {
  jti: string
  workspaceId: string
  sessionId?: string
  pluginId?: string
  capabilities: readonly string[]
  expiresAt: string
}

export interface TestResourceScopes {
  workspaceId: string
  sessionId?: string
  pluginId?: string
  paths?: readonly string[]
  [key: string]: unknown
}

export interface TestBridgeAuthResolution {
  context: BridgeAuthContext
  effectiveCapabilities: readonly string[]
  resourceScopes: TestResourceScopes
}

export interface TestBridgeAuthPolicy {
  resolve(input: {
    callerClass: BridgeCallerClass
    workspaceId?: string
    sessionId?: string
    pluginId?: string
    capabilities?: readonly string[]
    actor?: BridgeActorAttribution
    token?: TestRuntimeTokenClaims
  }): TestBridgeAuthResolution
}

export interface CapturedBridgeLogEntry {
  level: "debug" | "info" | "warn" | "error"
  message: string
  fields: Record<string, unknown>
}

export interface SensitiveBridgeValues {
  tokens?: readonly string[]
  authorizationHeaders?: readonly string[]
  answers?: readonly string[]
  fileContents?: readonly string[]
  hostPaths?: readonly string[]
  requestPayloads?: readonly string[]
}

export function createTestActor(
  actorKind: BridgeActorAttribution["actorKind"],
  label = `${actorKind}:test`,
): BridgeActorAttribution {
  return { actorKind, performedBy: { label } }
}

export function createTestBridgeContext(
  overrides: Partial<BridgeAuthContext> = {},
): BridgeAuthContext {
  const callerClass = overrides.callerClass ?? "server"
  const actor = overrides.actor ?? createTestActor(
    callerClass === "browser" ? "human" : callerClass === "runtime" ? "agent" : "system",
  )

  return {
    callerClass,
    workspaceId: overrides.workspaceId ?? "workspace-test",
    sessionId: overrides.sessionId ?? "session-test",
    pluginId: overrides.pluginId,
    capabilities: overrides.capabilities ?? [],
    actor,
    tokenId: overrides.tokenId,
    expiresAt: overrides.expiresAt,
  }
}

export function createFakeBridgeAuthPolicy(
  defaults: Partial<BridgeAuthContext> & { resourceScopes?: Partial<TestResourceScopes> } = {},
): TestBridgeAuthPolicy {
  return {
    resolve(input) {
      const token = input.token
      const context = createTestBridgeContext({
        ...defaults,
        callerClass: input.callerClass,
        workspaceId: input.workspaceId ?? token?.workspaceId ?? defaults.workspaceId,
        sessionId: input.sessionId ?? token?.sessionId ?? defaults.sessionId,
        pluginId: input.pluginId ?? token?.pluginId ?? defaults.pluginId,
        capabilities: input.capabilities ?? token?.capabilities ?? defaults.capabilities,
        actor: input.actor ?? defaults.actor,
        tokenId: token?.jti ?? defaults.tokenId,
        expiresAt: token?.expiresAt ?? defaults.expiresAt,
      })
      return {
        context,
        effectiveCapabilities: context.capabilities,
        resourceScopes: {
          workspaceId: context.workspaceId,
          sessionId: context.sessionId,
          pluginId: context.pluginId,
          ...defaults.resourceScopes,
        },
      }
    },
  }
}

export function createTestRuntimeTokenClaims(
  overrides: Partial<TestRuntimeTokenClaims> = {},
): TestRuntimeTokenClaims {
  return {
    jti: overrides.jti ?? "jti-test-redacted",
    workspaceId: overrides.workspaceId ?? "workspace-test",
    sessionId: overrides.sessionId ?? "session-test",
    pluginId: overrides.pluginId ?? "plugin-test",
    capabilities: overrides.capabilities ?? ["example:catalog.search"],
    expiresAt: overrides.expiresAt ?? "2099-01-01T00:00:00.000Z",
  }
}

export function createTestBridgeOperationDefinition<TInput = unknown, TOutput = unknown>(
  overrides: Partial<WorkspaceBridgeOperationDefinition<TInput, TOutput>> = {},
): WorkspaceBridgeOperationDefinition<TInput, TOutput> {
  return {
    op: overrides.op ?? "test.v1.echo",
    version: overrides.version ?? 1,
    owner: overrides.owner ?? "test",
    callerClassesAllowed: overrides.callerClassesAllowed ?? ["server"],
    requiredCapabilities: overrides.requiredCapabilities ?? [],
    inputSchema: overrides.inputSchema ?? { type: "object" },
    outputSchema: overrides.outputSchema ?? { type: "object" },
    timeoutMs: overrides.timeoutMs ?? 1_000,
    maxInputBytes: overrides.maxInputBytes ?? 8_192,
    maxOutputBytes: overrides.maxOutputBytes ?? 8_192,
    idempotencyPolicy: overrides.idempotencyPolicy ?? "none",
  }
}

export function assertNoGenericWorkspaceFilesOps(
  definitions: readonly Pick<WorkspaceBridgeOperationDefinition, "op">[],
): void {
  const invalid = definitions.find((definition) => definition.op.startsWith("workspace-files.v1."))
  if (invalid) {
    throw createWorkspaceBridgeError(
      WorkspaceBridgeErrorCode.InvalidRequest,
      `Generic workspace file bridge op is not allowed in v1: ${invalid.op}`,
    )
  }
}

export function createTestFileAssetPointer(
  overrides: Partial<WorkspaceBridgeFileAssetPointer> = {},
): WorkspaceBridgeFileAssetPointer {
  return {
    kind: "file-asset",
    path: overrides.path ?? "generated/test-output.json",
    contentType: overrides.contentType ?? "application/json",
    byteLength: overrides.byteLength ?? 2,
    rawUrl: overrides.rawUrl ?? "/api/v1/files/raw?path=generated%2Ftest-output.json",
  }
}

export function redactBridgeValue(
  value: unknown,
  sensitive: SensitiveBridgeValues = {},
): unknown {
  const secrets = collectSensitiveValues(sensitive)
  if (typeof value === "string") return redactString(value, secrets)
  if (Array.isArray(value)) return value.map((item) => redactBridgeValue(item, sensitive))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveKey(key)) out[key] = BRIDGE_TEST_REDACTION
      else out[key] = redactBridgeValue(child, sensitive)
    }
    return out
  }
  return value
}

export function createCapturedBridgeLogger(sensitive: SensitiveBridgeValues = {}) {
  const entries: CapturedBridgeLogEntry[] = []
  const log = (level: CapturedBridgeLogEntry["level"], message: string, fields: Record<string, unknown> = {}) => {
    entries.push({
      level,
      message: redactString(message, collectSensitiveValues(sensitive)),
      fields: redactBridgeValue(fields, sensitive) as Record<string, unknown>,
    })
  }
  return {
    entries,
    debug: (message: string, fields?: Record<string, unknown>) => log("debug", message, fields),
    info: (message: string, fields?: Record<string, unknown>) => log("info", message, fields),
    warn: (message: string, fields?: Record<string, unknown>) => log("warn", message, fields),
    error: (message: string, fields?: Record<string, unknown>) => log("error", message, fields),
    text: () => entries.map((entry) => JSON.stringify(entry)).join("\n"),
  }
}

export function assertNoSensitiveBridgeLeaks(
  text: string,
  sensitive: SensitiveBridgeValues,
): void {
  const leaked = collectSensitiveValues(sensitive).filter((value) => value && text.includes(value))
  if (leaked.length > 0) {
    throw new Error(`Bridge log leaked sensitive value(s): ${leaked.map(() => BRIDGE_TEST_REDACTION).join(", ")}`)
  }
  if (/Authorization:\s*Bearer\s+/i.test(text) || /Bearer\s+[A-Za-z0-9._~-]{8,}/.test(text)) {
    throw new Error("Bridge log leaked bearer authorization material")
  }
  if (/\n\s*at\s+\S+\s*\(/.test(text)) {
    throw new Error("Bridge log leaked stack trace frames")
  }
}

export function createFakeClock(now = "2026-01-01T00:00:00.000Z") {
  let current = new Date(now).getTime()
  return {
    now: () => new Date(current),
    nowMs: () => current,
    advanceMs: (ms: number) => {
      current += ms
      return new Date(current)
    },
  }
}

function isSensitiveKey(key: string): boolean {
  return /token|authorization|answer|payload|content|stack|secret|password|nonce/i.test(key)
}

function collectSensitiveValues(sensitive: SensitiveBridgeValues): string[] {
  return [
    ...(sensitive.tokens ?? []),
    ...(sensitive.authorizationHeaders ?? []),
    ...(sensitive.answers ?? []),
    ...(sensitive.fileContents ?? []),
    ...(sensitive.hostPaths ?? []),
    ...(sensitive.requestPayloads ?? []),
  ].filter(Boolean)
}

function redactString(value: string, secrets: readonly string[]): string {
  return secrets.reduce((current, secret) => current.split(secret).join(BRIDGE_TEST_REDACTION), value)
}
