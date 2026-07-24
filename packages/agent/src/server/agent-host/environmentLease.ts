import type { RuntimeBundle, RuntimeModeAdapter } from '../runtime/mode'
import { AgentGatewayError, AgentGatewayErrorCode } from '../../shared/index'
import type { WorkspaceProvisioningResult } from '../workspace/provisioning'
import type { ResolvedEnvironmentScope } from './types'

export interface EnvironmentProvisioningSnapshot {
  readonly changed: boolean
  readonly env: Readonly<Record<string, string>>
  readonly pathEntries: readonly string[]
  readonly skillPaths: readonly string[]
}

interface EnvironmentGeneration {
  readonly bundle: RuntimeBundle
  readonly provisioning?: EnvironmentProvisioningSnapshot
}

interface EnvironmentRecord {
  readonly key: string
  readonly scope: ResolvedEnvironmentScope
  readonly abort: AbortController
  readonly generation: Promise<EnvironmentGeneration>
  references: number
  disposalPromise?: Promise<void>
}

export interface EnvironmentLease {
  readonly bundle: RuntimeBundle
  /** One immutable Environment-owned snapshot shared by every compatible Agent binding. */
  readonly provisioning?: EnvironmentProvisioningSnapshot
  release(): void
  retire(): Promise<void>
}

function freezeProvisioningSnapshot(
  value: WorkspaceProvisioningResult | undefined,
): EnvironmentProvisioningSnapshot | undefined {
  if (!value) return undefined
  return Object.freeze({
    changed: value.changed,
    env: Object.freeze({ ...value.env }),
    pathEntries: Object.freeze([...value.pathEntries]),
    skillPaths: Object.freeze([...value.skillPaths]),
  })
}

function closedError(): AgentGatewayError {
  return new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'agent host is closing')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Host-generation Environment registry. Agent bindings with the same verified
 * workspace scope and placement share exactly one provider/provisioning result.
 */
export class EnvironmentLeaseManager {
  private readonly records = new Map<string, EnvironmentRecord>()
  private closePromise?: Promise<void>
  private closed = false

  constructor(private readonly adapter: RuntimeModeAdapter) {}

  async acquire(
    workspaceScopeId: string,
    environment: ResolvedEnvironmentScope,
  ): Promise<EnvironmentLease> {
    if (this.closed) throw closedError()
    const key = JSON.stringify([workspaceScopeId, environment.placementIdentity])
    let record = this.records.get(key)
    if (record && record.scope.provisioningFingerprint !== environment.provisioningFingerprint) {
      throw new AgentGatewayError(
        AgentGatewayErrorCode.AGENT_SHARED_ENVIRONMENT_UNAVAILABLE,
        'agents in one workspace resolved incompatible environment provisioning',
        { placementIdentity: environment.placementIdentity },
      )
    }
    if (!record) {
      const abort = new AbortController()
      const generation = this.createEnvironment(workspaceScopeId, environment, abort.signal)
      record = {
        key,
        scope: environment,
        abort,
        generation,
        references: 0,
      }
      this.records.set(key, record)
      generation.catch(() => {
        if (this.records.get(key) === record && record?.references === 0) {
          this.records.delete(key)
        }
      })
    }
    record.references += 1
    let generation: EnvironmentGeneration
    try {
      generation = await record.generation
      if (this.closed || record.abort.signal.aborted || this.records.get(key) !== record) throw closedError()
    } catch (error) {
      record.references = Math.max(0, record.references - 1)
      if (record.references === 0 && this.records.get(key) === record) this.records.delete(key)
      throw error
    }
    let released = false
    const release = () => {
      if (released) return
      released = true
      record!.references = Math.max(0, record!.references - 1)
    }
    return {
      bundle: generation.bundle,
      provisioning: generation.provisioning,
      release,
      retire: async () => {
        release()
        if (record!.references !== 0) return
        if (this.records.get(key) === record) this.records.delete(key)
        record!.abort.abort()
        await this.disposeRecord(record!)
      },
    }
  }

  private async createEnvironment(
    workspaceScopeId: string,
    environment: ResolvedEnvironmentScope,
    signal: AbortSignal,
  ): Promise<EnvironmentGeneration> {
    const compatibilityModeContext = (environment as ResolvedEnvironmentScope & {
      readonly compatibilityModeContext?: Partial<Parameters<RuntimeModeAdapter['create']>[0]>
    }).compatibilityModeContext
    const bundle = await this.adapter.create({
      workspaceRoot: environment.workspaceRoot,
      sessionId: workspaceScopeId,
      workspaceId: workspaceScopeId,
      templatePath: environment.templatePath,
      ...compatibilityModeContext,
    })
    try {
      if (signal.aborted) throw closedError()
      const provisioning = freezeProvisioningSnapshot(
        await environment.provisionRuntime?.({ runtimeBundle: bundle, signal }),
      )
      if (signal.aborted) throw closedError()
      return { bundle, provisioning }
    } catch (error) {
      await bundle.disposeRuntime?.().catch(() => {})
      throw error
    }
  }

  /** Fence new acquisitions and cooperatively cancel pending provisioning. */
  startDrain(): void {
    if (this.closed) return
    this.closed = true
    for (const record of this.records.values()) record.abort.abort()
  }

  close(graceMs = 5_000): Promise<void> {
    this.startDrain()
    this.closePromise ??= this.closeAll(Math.max(0, graceMs))
    return this.closePromise
  }

  private disposeRecord(record: EnvironmentRecord): Promise<void> {
    record.disposalPromise ??= (async () => {
      let generation: EnvironmentGeneration
      try {
        generation = await record.generation
      } catch {
        // Creation owns and reports its failure. If it acquired provider bytes,
        // createEnvironment already owns their exactly-once cleanup.
        return
      }
      await generation.bundle.disposeRuntime?.()
    })()
    // A shutdown deadline may detach this cleanup. Always observe its eventual
    // rejection, and keep this one promise as the exactly-once teardown owner.
    record.disposalPromise.catch(() => {})
    return record.disposalPromise
  }

  private async closeAll(graceMs: number): Promise<void> {
    const records = [...this.records.values()]
    this.records.clear()
    const disposals = records.map((record) => this.disposeRecord(record))
    if (disposals.length === 0) return
    const result = await Promise.race([
      Promise.allSettled(disposals).then((results) => ({ completed: true as const, results })),
      delay(graceMs).then(() => ({ completed: false as const })),
    ])
    if (!result.completed) return
    const failed = result.results.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
    if (failed) throw failed.reason
  }

  /** Test/diagnostic snapshot; does not expose roots or providers publicly. */
  size(): number {
    return this.records.size
  }
}
