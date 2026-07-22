import type { FastifyRequest } from "fastify"
import type { HostedDueRunResult } from "./hostedDueRunService"

export interface HostedDueRunner {
  runDue(request?: FastifyRequest): Promise<HostedDueRunResult>
}

/** Shares one in-process due evaluation across timer and HTTP wake-ups. */
export class HostedDueCoordinator implements HostedDueRunner {
  private active: Promise<HostedDueRunResult> | undefined

  constructor(private readonly runner: HostedDueRunner) {}

  runDue(request?: FastifyRequest): Promise<HostedDueRunResult> {
    if (this.active) return this.active
    const active = request ? this.runner.runDue(request) : this.runner.runDue()
    this.active = active
    void active.then(
      () => this.clear(active),
      () => this.clear(active),
    )
    return active
  }

  private clear(completed: Promise<HostedDueRunResult>): void {
    if (this.active === completed) this.active = undefined
  }
}
