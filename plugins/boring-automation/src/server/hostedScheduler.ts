import { Cron } from "croner"
import type { FastifyBaseLogger } from "fastify"
import type { HostedDueRunResult } from "./hostedDueRunService"

const HOSTED_AUTOMATION_TICK_PATTERN = "* * * * *"

type SchedulerLogger = Pick<FastifyBaseLogger, "debug" | "info" | "warn" | "error">
type RunDue = () => Promise<HostedDueRunResult>
type ScheduledTick = () => Promise<void>
type CronJob = Pick<Cron, "stop">
type ScheduleCron = (tick: ScheduledTick) => CronJob

export interface HostedAutomationSchedulerOptions {
  runDue: RunDue
  logger: SchedulerLogger
  scheduleCron?: ScheduleCron
}

/** Process-local wake-up for hosted due evaluation. Database constraints remain the cross-process execution guard. */
export class HostedAutomationScheduler {
  private job: CronJob | undefined
  private activeTick: Promise<void> | undefined
  private stopped = true

  constructor(private readonly options: HostedAutomationSchedulerOptions) {}

  start(): void {
    if (this.job) return
    this.stopped = false
    const scheduleCron = this.options.scheduleCron ?? defaultScheduleCron
    this.job = scheduleCron(async () => await this.tick())
    void this.tick()
  }

  beginShutdown(): void {
    this.stopped = true
    this.job?.stop()
    this.job = undefined
  }

  async drain(): Promise<void> {
    await this.activeTick
  }

  async stop(): Promise<void> {
    this.beginShutdown()
    await this.drain()
  }

  private tick(): Promise<void> {
    if (this.stopped || this.activeTick) return Promise.resolve()
    const active = this.executeTick()
    this.activeTick = active
    void active.then(
      () => this.clearActiveTick(active),
      () => this.clearActiveTick(active),
    )
    return active
  }

  private async executeTick(): Promise<void> {
    try {
      const result = await this.options.runDue()
      const summary = summarize(result)
      if (summary.failed > 0) {
        this.options.logger.warn({ automationScheduler: summary }, "hosted automation scheduler tick completed with failures")
      } else if (summary.started > 0) {
        this.options.logger.info({ automationScheduler: summary }, "hosted automation scheduler started due runs")
      } else {
        this.options.logger.debug({ automationScheduler: summary }, "hosted automation scheduler tick completed")
      }
    } catch (error) {
      this.options.logger.error({
        automationScheduler: {
          event: "tick-failed",
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
      }, "hosted automation scheduler tick failed")
    }
  }

  private clearActiveTick(completed: Promise<void>): void {
    if (this.activeTick === completed) this.activeTick = undefined
  }
}

function defaultScheduleCron(tick: ScheduledTick): CronJob {
  return new Cron(HOSTED_AUTOMATION_TICK_PATTERN, {
    mode: "5-part",
    protect: true,
    unref: true,
  }, tick)
}

function summarize(result: HostedDueRunResult) {
  let started = 0
  let skipped = 0
  let failed = 0
  for (const outcome of result.outcomes) {
    if (outcome.kind === "started") started += 1
    else if (outcome.kind === "skipped") skipped += 1
    else failed += 1
  }
  return {
    event: "tick-completed",
    evaluatedAt: result.now,
    started,
    skipped,
    failed,
  }
}
