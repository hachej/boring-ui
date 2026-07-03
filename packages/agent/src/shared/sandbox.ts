import type { WorkspaceRuntimeContext } from './runtime'
import type { Workspace } from './workspace'

/**
 * Capabilities a sandbox advertises. Consumers use this set to decide
 * whether a tool can run (e.g. `executeIsolatedCodeTool` only registers
 * when `'isolated-code'` is present). Backends opt in by including the
 * capability string in their `Sandbox.capabilities` array.
 *
 * Open string union — backends and downstream packages can extend it
 * without modifying this file (TypeScript declaration-merging or just
 * casting). New capabilities to expect over time:
 *   - `'gpu'`           — backend can attach GPUs to isolated-code calls
 *   - `'persistent-fs'` — backend retains workspace state across sessions
 *   - `'snapshot'`      — backend supports baking + restoring snapshots
 *   - `'network-allow'` — backend can apply egress allow/deny lists
 */
export type SandboxCapability =
  | 'exec'
  | 'isolated-code'
  | (string & {})

/**
 * Where the sandbox actually executes — relative to the agent backend
 * process running pi.
 *
 * - `'server'` — same process / same host as the agent backend (e.g.
 *   `DirectSandbox`, `BwrapSandbox`).
 * - `'remote'` — a separate machine reached over the network (e.g.
 *   `VercelSandboxExec` Firecracker VM, SSH, Modal, Docker host
 *   accessed by API). Implementations must tolerate higher latency and
 *   handle abort by signalling the remote.
 * - `'browser'` — runs in the user's browser (e.g. WASM bash,
 *   `JustBashSandbox`). Reserved for future browser-agent mode.
 */
export type SandboxPlacement = 'server' | 'remote' | 'browser'

export interface Sandbox {
  /** Stable identifier for this sandbox instance. */
  readonly id: string

  /** Where the sandbox runs relative to the agent backend. */
  readonly placement: SandboxPlacement

  /**
   * Provider name — e.g. `'direct'`, `'bwrap'`, `'vercel-sandbox'`,
   * `'docker'`, `'modal'`, `'apple-container'`, `'ssh'`. Used for
   * telemetry, diagnostics, and capability negotiation. Free-form
   * convention: matches the runtime mode id where one exists.
   */
  readonly provider: string

  /** Capabilities this sandbox advertises (used for tool gating). */
  readonly capabilities: readonly SandboxCapability[]

  /** Agent-visible runtime cwd; must match the paired Workspace root. */
  readonly runtimeContext: WorkspaceRuntimeContext

  /**
   * Optional initialization hook. Some backends bind to a workspace +
   * session at construction (Vercel: snapshot warm-up; Bwrap: bind
   * mounts). Ephemeral backends (Direct, on-demand Docker exec) can
   * omit this entirely.
   */
  init?(ctx: { workspace: Workspace; sessionId: string }): Promise<void>

  /**
   * Run a shell command. Required capability: `'exec'`.
   *
   * Implementations MUST honor `signal` for abort, `timeoutMs` for
   * timeout, and `maxOutputBytes` for output truncation (and set
   * `truncated: true` in the result when truncation fires).
   *
   * The optional `onStdout` / `onStderr` callbacks (when implemented)
   * stream output incrementally as bytes arrive. When omitted,
   * implementations buffer normally and surface output via
   * `ExecResult.stdout` / `stderr` only. See the `Sandbox.exec` streaming
   * extension added in Phase 1.0.
   */
  exec(cmd: string, opts?: ExecOptions): Promise<ExecResult>

  /**
   * Run a self-contained snippet of code in an ephemeral sandbox
   * instance. Capability: `'isolated-code'`. Optional — backends that
   * cannot offer per-call isolation (`DirectSandbox`, `BwrapSandbox`)
   * omit this method entirely.
   */
  executeIsolatedCode?(input: IsolatedCodeInput): Promise<IsolatedCodeOutput>

  dispose?(): Promise<void>
}

export interface ExecOptions {
  /** Runtime-visible cwd. Relative paths resolve from `runtimeContext.runtimeCwd`. */
  cwd?: string
  env?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
  maxOutputBytes?: number
  onHeartbeat?: (elapsedMs: number) => void
  onStdout?: (chunk: Uint8Array) => void
  onStderr?: (chunk: Uint8Array) => void
}

export interface ExecResult {
  stdout: Uint8Array
  stderr: Uint8Array
  exitCode: number
  durationMs: number
  truncated: boolean
  stdoutEncoding?: 'utf-8' | 'binary'
  stderrEncoding?: 'utf-8' | 'binary'
}

/**
 * Abstract resource hints for `executeIsolatedCode`. Backends round to
 * their own size tiers (Vercel: `xxs`/…/`l`; Modal: `cpu`/`memory`
 * floats; Docker: cgroups). Each field is a HINT, not a contract — a
 * backend may ignore or clamp values it cannot honor.
 */
export interface SandboxResources {
  /** Requested logical CPU cores. Backend rounds up. */
  cpuCores?: number
  /** Requested memory in MB. Backend rounds up. */
  memoryMb?: number
  /**
   * GPU class hint. Free-form vendor-specific token (e.g. `'t4'`,
   * `'a10g'`, `'h100'`). Empty/omitted means CPU-only. Only honored
   * when the sandbox advertises capability `'gpu'`.
   */
  gpu?: string
}

export interface IsolatedCodeInput {
  code: string
  language: 'python' | 'shell'

  /**
   * Container / snapshot identifier. Format is vendor-specific:
   * Docker → image ref (`node:20`), Vercel → `snapshotId`, Modal →
   * image name, Apple-container → bundle path. Treat as opaque.
   */
  image?: string

  /**
   * Per-call dependencies (npm/pip-style). Honored by backends that
   * build environments on demand (Modal, Vercel snapshot-bake).
   * Ignored by backends that require pre-built images (vanilla Docker
   * exec).
   */
  packages?: string[]

  /** Reuse an existing sandbox handle if the backend supports it. */
  sandboxId?: string

  /** Generic resource request. Backends round to their own size tiers. */
  resources?: SandboxResources

  /**
   * Backend-specific knobs that don't fit the generic shape — opaque
   * pass-through. Example: Modal's `min_containers`, Docker's
   * `--cap-add`, Vercel's `region`. Consumers should never read this
   * field; it exists so callers can target a specific provider.
   */
  vendorHints?: Record<string, unknown>

}

export interface IsolatedCodeOutput {
  sandboxId: string
  stdout: string
  stderr: string
  exitCode: number
}
