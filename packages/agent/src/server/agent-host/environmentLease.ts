import type { RuntimeBundle, RuntimeModeAdapter } from '../runtime/mode'
import { AgentGatewayError, AgentGatewayErrorCode } from '../../shared/index'
import type { ResolvedEnvironmentScope } from './types'

interface EnvironmentRecord {
  readonly key: string
  readonly scope: ResolvedEnvironmentScope
  readonly abort: AbortController
  readonly bundle: Promise<RuntimeBundle>
  references: number
  disposed: boolean
}

export interface EnvironmentLease {
  readonly bundle: RuntimeBundle
  release(): void
  retire(): Promise<void>
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
    if (this.closed) throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'agent host is closing')
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
      const bundle = this.createEnvironment(workspaceScopeId, environment, abort.signal)
      record = {
        key,
        scope: environment,
        abort,
        bundle,
        references: 0,
        disposed: false,
      }
      this.records.set(key, record)
      bundle.catch(() => {
        if (this.records.get(key) === record && record?.references === 0) {
          this.records.delete(key)
        }
      })
    }
    record.references += 1
    let bundle: RuntimeBundle
    try {
      bundle = await record.bundle
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
      bundle,
      release,
      retire: async () => {
        release()
        if (record!.references !== 0 || record!.disposed) return
        record!.disposed = true
        if (this.records.get(key) === record) this.records.delete(key)
        record!.abort.abort()
        await bundle.disposeRuntime?.()
      },
    }
  }

  private async createEnvironment(
    workspaceScopeId: string,
    environment: ResolvedEnvironmentScope,
    signal: AbortSignal,
  ): Promise<RuntimeBundle> {
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
      await environment.provisionRuntime?.({ runtimeBundle: bundle, signal })
      return bundle
    } catch (error) {
      await bundle.disposeRuntime?.().catch(() => {})
      throw error
    }
  }

  close(): Promise<void> {
    this.closed = true
    this.closePromise ??= this.closeAll()
    return this.closePromise
  }

  private async closeAll(): Promise<void> {
    const records = [...this.records.values()]
    for (const record of records) record.abort.abort()
    let firstError: unknown
    for (const record of records) {
      if (record.disposed) continue
      record.disposed = true
      try {
        const bundle = await record.bundle
        await bundle.disposeRuntime?.()
      } catch (error) {
        firstError ??= error
      }
    }
    this.records.clear()
    if (firstError !== undefined) throw firstError
  }

  /** Test/diagnostic snapshot; does not expose roots or providers publicly. */
  size(): number {
    return this.records.size
  }
}
