import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "node:fs"
import { setTimeout } from "node:timers/promises"
import { fileURLToPath } from "node:url"

import { type DataBridgeBslError, type DataBridgeBslQuery, type DataBridgeTableResult } from "../../shared"

const MAX_STDERR_BYTES = 4_096
const MAX_QUEUED_OPERATIONS = 100
const WORKER_STOP_TIMEOUT_MS = 1000

type WorkerMethod = "ready" | "queryBatch"

type WorkerMessage<T = unknown> = {
  id: string
  ok: true
  payload?: T
}

type WorkerMessageError = {
  id: string
  ok: false
  error: {
    code: string
    message: string
  }
}

export type PythonBslQuery = DataBridgeBslQuery & {
  modelPath: string
  profile?: string
  profileFile?: string
}

export type PythonBslRuntimeRequestResult =
  | { ok: true; output: DataBridgeTableResult }
  | { ok: false; error: DataBridgeBslError }

export interface PythonBslRuntimeOptions {
  pythonExecutable?: string
  workerPath?: string
  spawn?: typeof spawn
}

interface PendingRequest<T> {
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function bslRuntimeError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

function createAbortError(): Error {
  return Object.assign(new Error("BSL query aborted"), { name: "AbortError", code: "BSL_QUERY_ABORTED" })
}

function defaultWorkerPath(): string {
  const candidates = [
    // Built package path: dist/server/index.js -> python/bsl_worker.py.
    new URL("../../python/bsl_worker.py", import.meta.url),
    // Source/vitest path: src/server/bsl/pythonBslRuntime.ts -> python/bsl_worker.py.
    new URL("../../../python/bsl_worker.py", import.meta.url),
  ].map((url) => fileURLToPath(url))

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!
}

export class PythonBslRuntime {
  private readonly pythonExecutable: string
  private readonly workerPath: string
  private readonly spawnProcess: typeof spawn

  private state: "ready" | "stopped" | "closed" = "stopped"
  private child: ChildProcessWithoutNullStreams | null = null
  private nextRequestId = 0
  private queue: Promise<void> = Promise.resolve()
  private stdoutBuffer = ""
  private stderrBuffer = ""
  private queuedOperations = 0

  private readonly pendingRequests = new Map<string, PendingRequest<unknown>>()

  constructor(options: PythonBslRuntimeOptions = {}) {
    this.pythonExecutable = options.pythonExecutable ?? process.env.BORING_DATA_BRIDGE_PYTHON ?? "python3"
    this.workerPath = options.workerPath ?? defaultWorkerPath()
    this.spawnProcess = options.spawn ?? spawn
  }

  async queryBatch(payloads: PythonBslQuery[], signal?: AbortSignal): Promise<PythonBslRuntimeRequestResult[]> {
    return await this.serialize(async () => {
      if (signal?.aborted) throw createAbortError()
      await this.ensureReady(signal)
      return await this.sendRequest<PythonBslRuntimeRequestResult[]>("queryBatch", { queries: payloads }, signal)
    })
  }

  async close(signal?: AbortSignal): Promise<void> {
    this.state = "closed"
    if (signal?.aborted) {
      await this.stopWorker("abort", "kill")
      return
    }

    await Promise.race([this.queue, setTimeout(WORKER_STOP_TIMEOUT_MS)])
    await this.stopWorker("shutdown", "graceful")
  }

  private async ensureReady(signal?: AbortSignal): Promise<void> {
    if (this.state === "ready") return
    if (this.state === "closed") throw bslRuntimeError("BSL runtime is closed", "BSL_RUNTIME_CLOSED")
    await this.startWorker(signal)
  }

  private async startWorker(signal?: AbortSignal): Promise<void> {
    const child = this.spawnProcess(this.pythonExecutable, ["-u", this.workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    })

    this.child = child
    this.stdoutBuffer = ""
    this.stderrBuffer = ""

    const onStdout = (chunk: Buffer | string) => {
      this.stdoutBuffer += String(chunk)
      const lines = this.stdoutBuffer.split("\n")
      this.stdoutBuffer = lines.pop() ?? ""
      for (const line of lines) this.handleWorkerLine(line)
    }

    const onStderr = (chunk: Buffer | string) => {
      const diagnostics = String(chunk)
      this.stderrBuffer = `${this.stderrBuffer}${diagnostics}`.slice(-MAX_STDERR_BYTES)
      process.stderr.write(diagnostics)
    }

    const onExit = (code: number | null, codeSignal: NodeJS.Signals | null) => {
      child.stdout.off("data", onStdout)
      child.stderr.off("data", onStderr)
      const details = code === null ? `signal ${String(codeSignal)}` : `code ${code}`
      this.handleWorkerFailure(bslRuntimeError(`BSL worker exited (${details})`, "BSL_WORKER_EXITED"))
    }

    child.stdout.on("data", onStdout)
    child.stderr.on("data", onStderr)
    child.once("error", (error) => this.handleWorkerFailure(error))
    child.once("exit", onExit)

    try {
      await this.sendRequestRaw<void>("ready", {}, signal)
      if (this.state !== "closed") this.state = "ready"
    } catch (error) {
      const startupError = error instanceof Error ? error : bslRuntimeError("Failed to start BSL worker", "BSL_WORKER_START_FAILED")
      this.handleWorkerFailure(startupError)
      throw startupError
    }
  }

  private async sendRequest<T>(method: WorkerMethod, payload: unknown, signal?: AbortSignal): Promise<T> {
    if (this.state !== "ready") throw bslRuntimeError("BSL worker is not ready", "BSL_WORKER_NOT_READY")
    return await this.sendRequestRaw<T>(method, payload, signal)
  }

  private async sendRequestRaw<T>(method: WorkerMethod, payload: unknown, signal?: AbortSignal): Promise<T> {
    const child = this.child
    if (!child) throw bslRuntimeError("BSL worker is not available", "BSL_WORKER_NOT_AVAILABLE")
    if (signal?.aborted) throw createAbortError()

    const id = `${this.nextRequestId++}`
    const response = new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort)
        this.pendingRequests.delete(id)
      }
      const onAbort = () => {
        // Keep the shared worker alive so dashboard cancellations do not discard
        // the warm model cache; the worker may finish this stale request before
        // reading the next queued query.
        cleanup()
        reject(createAbortError())
      }

      if (signal) signal.addEventListener("abort", onAbort, { once: true })
      this.pendingRequests.set(id, {
        resolve: (value) => {
          cleanup()
          resolve(value as T)
        },
        reject: (error) => {
          cleanup()
          reject(error)
        },
      })
    })

    const accepted = child.stdin.write(`${JSON.stringify({ id, method, payload })}\n`)
    if (!accepted) {
      await Promise.race([
        new Promise<void>((resolve) => child.stdin.once("drain", () => resolve())),
        response.then(() => undefined),
      ])
    }

    return await response
  }

  private handleWorkerLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let message: WorkerMessage<unknown> | WorkerMessageError
    try {
      message = JSON.parse(trimmed) as WorkerMessage<unknown> | WorkerMessageError
    } catch {
      return
    }

    if (typeof message.id !== "string" || typeof message.ok !== "boolean") return

    const pending = this.pendingRequests.get(message.id)
    if (!pending) return

    this.pendingRequests.delete(message.id)
    if (!message.ok) {
      pending.reject(bslRuntimeError(message.error?.message ?? "BSL worker request failed", "BSL_WORKER_REQUEST_FAILED"))
      return
    }

    pending.resolve(message.payload)
  }

  private handleWorkerFailure(error: Error): void {
    const child = this.child
    if (!child) {
      if (this.state !== "closed") this.state = "stopped"
      return
    }

    const toReject = [...this.pendingRequests.values()]
    this.pendingRequests.clear()
    this.child = null
    if (this.state !== "closed") this.state = "stopped"

    child.removeAllListeners()
    child.kill("SIGKILL")
    for (const request of toReject) request.reject(error)
  }

  private async stopWorker(reason: string, mode: "graceful" | "kill"): Promise<void> {
    const child = this.child
    if (!child) {
      if (this.state !== "closed") this.state = "stopped"
      return
    }

    child.removeAllListeners()

    let closed = false
    const closedPromise = new Promise<void>((resolve) => {
      child.once("close", () => {
        closed = true
        resolve()
      })
    })
    if (mode === "graceful") child.stdin.end()
    else child.kill("SIGKILL")

    await Promise.race([closedPromise, setTimeout(WORKER_STOP_TIMEOUT_MS)])
    if (!closed) {
      child.kill("SIGKILL")
      await Promise.race([closedPromise, setTimeout(WORKER_STOP_TIMEOUT_MS)])
    }

    this.child = null
    if (this.state !== "closed") this.state = "stopped"

    for (const request of this.pendingRequests.values()) {
      request.reject(bslRuntimeError(`BSL worker terminated (${reason})`, "BSL_WORKER_TERMINATED"))
    }
    this.pendingRequests.clear()
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    if (this.queuedOperations >= MAX_QUEUED_OPERATIONS) {
      return Promise.reject(bslRuntimeError("BSL runtime queue is full", "BSL_RUNTIME_QUEUE_FULL"))
    }

    this.queuedOperations += 1
    const next = this.queue.then(async () => {
      if (this.state === "closed") throw bslRuntimeError("BSL runtime is closed", "BSL_RUNTIME_CLOSED")
      return await operation()
    }).finally(() => {
      this.queuedOperations -= 1
    })

    this.queue = next.then(() => undefined, () => undefined)
    return next
  }
}
