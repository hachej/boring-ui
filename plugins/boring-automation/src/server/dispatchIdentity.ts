import type { FastifyRequest } from "fastify"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import type { AutomationRun } from "../shared/types"
import type { VerifiedAutomationActor } from "./dispatchRunExecutor"
import { safeErrorMessage } from "./agentEventProjection"
import type { AutomationStore } from "./store"

export class AutomationSessionUnaddressableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AutomationSessionUnaddressableError"
  }
}

export class DispatchIdentity {
  sessionId: string | null = null
  dispatchReceipt: AutomationRun["dispatchReceipt"] | null = null
  durableSessionId: string | null = null
  accepted = false
  persistenceFailed = false
  private addressabilityVerified = false

  constructor(private readonly options: {
    store: AutomationStore
    runId: string
    current: AutomationRun
    actor: VerifiedAutomationActor
    requireAddressability: boolean
    request?: FastifyRequest
    dispatcherResolver: WorkspaceAgentDispatcherResolver
    publish(run: AutomationRun): Promise<void>
  }) {}

  get current(): AutomationRun {
    return this.options.current
  }

  get dispatchInFlight(): boolean {
    return this.accepted || this.persistenceFailed
  }

  get isAddressabilityVerified(): boolean {
    return this.addressabilityVerified
  }

  isAlreadyPersisted(ref: { sessionId: string }, receipt?: object): boolean {
    return this.durableSessionId === ref.sessionId && (!receipt || Boolean(this.options.current.dispatchReceipt))
  }

  async persist(
    ref: { agentTypeId: string; sessionId: string },
    receipt?: Omit<NonNullable<AutomationRun["dispatchReceipt"]>, "ref">,
  ): Promise<void> {
    this.sessionId = ref.sessionId
    if (receipt) {
      this.accepted = true
      this.dispatchReceipt = { ref, ...receipt }
    }
    if (this.isAlreadyPersisted(ref, receipt)) return
    try {
      this.options.current = await this.options.store.updateRunLifecycle(this.options.runId, {
        status: "dispatching",
        sessionId: ref.sessionId,
        ...(this.dispatchReceipt ? { dispatchReceipt: this.dispatchReceipt } : {}),
      })
    } catch (error) {
      this.persistenceFailed = true
      throw error
    }
    this.durableSessionId = ref.sessionId
    await this.options.publish(this.options.current)
  }

  async verifyAddressability(): Promise<void> {
    if (!this.options.requireAddressability || this.addressabilityVerified) return
    const ref = this.dispatchReceipt?.ref
    if (!ref) throw new AutomationSessionUnaddressableError("automation dispatch completed without a durable session reference")
    const authorizeSession = this.options.dispatcherResolver.authorizeSession
    if (!authorizeSession) throw new AutomationSessionUnaddressableError("workspace session lookup is unavailable")
    try {
      await authorizeSession.call(this.options.dispatcherResolver, this.options.actor, ref, this.options.request ? { request: this.options.request } : undefined)
      this.addressabilityVerified = true
    } catch (error) {
      throw new AutomationSessionUnaddressableError(
        `recorded session ${ref.sessionId} could not be resolved through the workspace session lookup: ${safeErrorMessage(error)}`,
      )
    }
  }
}
