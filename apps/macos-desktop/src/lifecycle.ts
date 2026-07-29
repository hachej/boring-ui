export interface DesktopServerHandle {
  origin: string
  initialUrl: string
  close(): Promise<void>
}

export interface DesktopWindowHandle {
  isDestroyed(): boolean
  focus(): void
  close(): void
}

export interface DesktopLifecycleDependencies {
  startServer(): Promise<DesktopServerHandle>
  createWindow(server: DesktopServerHandle): Promise<{
    window: DesktopWindowHandle
    cleanup(): void
  }>
  reportStartupError(error: unknown): void
}

export class DesktopLifecycle {
  private server?: DesktopServerHandle
  private window?: DesktopWindowHandle
  private cleanupWindow?: () => void
  private createWindowPromise?: Promise<void>
  private startPromise?: Promise<void>
  private stopPromise?: Promise<void>
  private stopping = false

  constructor(private readonly dependencies: DesktopLifecycleDependencies) {}

  start(): Promise<void> {
    this.startPromise ??= this.startOnce()
    return this.startPromise
  }

  private async startOnce(): Promise<void> {
    try {
      this.server = await this.dependencies.startServer()
      if (!this.stopping) await this.createWindow()
    } catch (error) {
      await this.server?.close().catch(() => undefined)
      this.server = undefined
      this.dependencies.reportStartupError(error)
      throw error
    }
  }

  private createWindow(): Promise<void> {
    if (!this.server || (this.window && !this.window.isDestroyed())) return Promise.resolve()
    this.createWindowPromise ??= this.createWindowOnce().finally(() => {
      this.createWindowPromise = undefined
    })
    return this.createWindowPromise
  }

  private async createWindowOnce(): Promise<void> {
    if (!this.server || (this.window && !this.window.isDestroyed())) return
    const created = await this.dependencies.createWindow(this.server)
    this.window = created.window
    this.cleanupWindow = created.cleanup
  }

  async activate(): Promise<void> {
    await this.start()
    if (this.window && !this.window.isDestroyed()) {
      this.window.focus()
      return
    }
    await this.createWindow()
  }

  focus(): void {
    if (this.window && !this.window.isDestroyed()) this.window.focus()
  }

  windowClosed(window: DesktopWindowHandle): void {
    if (this.window !== window) return
    this.cleanupWindow?.()
    this.cleanupWindow = undefined
    this.window = undefined
  }

  stop(): Promise<void> {
    this.stopping = true
    this.stopPromise ??= this.stopOnce()
    return this.stopPromise
  }

  private async stopOnce(): Promise<void> {
    await this.startPromise?.catch(() => undefined)
    await this.createWindowPromise?.catch(() => undefined)
    this.cleanupWindow?.()
    this.cleanupWindow = undefined
    if (this.window && !this.window.isDestroyed()) this.window.close()
    this.window = undefined
    await this.server?.close()
    this.server = undefined
  }
}
