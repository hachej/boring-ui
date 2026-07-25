import { EventEmitter } from "node:events"
import { Writable, PassThrough } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { PythonBslRuntime, type PythonBslQuery } from "./pythonBslRuntime"

function bslQuery(overrides: Partial<PythonBslQuery> = {}): PythonBslQuery {
  return {
    language: "bsl",
    modelPath: "/tmp/model.yml",
    model: "semanticModel",
    query: "sm.table",
    limit: 10,
    ...overrides,
  }
}

function createFakeWorker(options: { hangQuery?: boolean } = {}) {
  const writes: unknown[] = []
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = new EventEmitter() as EventEmitter & {
    stdin: Writable
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }

  function emitMessage(payload: unknown) {
    const text = `${JSON.stringify(payload)}\n`
    stdout.write(text.slice(0, Math.max(1, Math.floor(text.length / 2))))
    stdout.write(text.slice(Math.max(1, Math.floor(text.length / 2))))
  }

  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      const message = JSON.parse(String(chunk)) as { id: string; method: string; payload?: { queries?: PythonBslQuery[] } }
      writes.push(message)
      queueMicrotask(() => {
        if (message.method === "ready") {
          emitMessage({ id: message.id, ok: true, payload: { ready: true } })
          return
        }
        if (message.method === "queryBatch" && !options.hangQuery) {
          emitMessage({
            id: message.id,
            ok: true,
            payload: (message.payload?.queries ?? []).map((query) => ({
              ok: true,
              output: {
                kind: "data-bridge.table",
                version: 1,
                columns: [{ name: "query", type: "string" }],
                rows: [{ query: query.query }],
                rowCount: 1,
                source: "bsl",
              },
            })),
          })
        }
      })
      callback()
    },
    final(callback) {
      queueMicrotask(() => child.emit("close", 0))
      callback()
    },
  })
  child.stdout = stdout
  child.stderr = stderr
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit("close", 0))
    return true
  })

  return { child, writes }
}

describe("PythonBslRuntime", () => {
  it("resolves the default worker from source checkouts", () => {
    const runtime = new PythonBslRuntime()
    expect((runtime as unknown as { workerPath: string }).workerPath).toMatch(/plugins\/data-bridge\/python\/bsl_worker\.py$/)
  })

  it("reuses one worker and sends BSL batches over the JSONL protocol", async () => {
    const worker = createFakeWorker()
    const spawn = vi.fn(() => worker.child as never)
    const runtime = new PythonBslRuntime({ spawn, workerPath: "/worker.py" })

    const first = await runtime.queryBatch([bslQuery({ query: "one" })])
    const second = await runtime.queryBatch([bslQuery({ query: "two" }), bslQuery({ query: "three" })])

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(first).toMatchObject([{ ok: true, output: { rows: [{ query: "one" }] } }])
    expect(second).toMatchObject([
      { ok: true, output: { rows: [{ query: "two" }] } },
      { ok: true, output: { rows: [{ query: "three" }] } },
    ])
    expect(worker.writes.map((write) => (write as { method: string }).method)).toEqual(["ready", "queryBatch", "queryBatch"])

    await runtime.close()
    expect(worker.child.kill).not.toHaveBeenCalled()
  })

  it("rejects aborted requests without killing the warm worker", async () => {
    const worker = createFakeWorker({ hangQuery: true })
    const runtime = new PythonBslRuntime({ spawn: vi.fn(() => worker.child as never), workerPath: "/worker.py" })
    const controller = new AbortController()
    const pending = runtime.queryBatch([bslQuery()], controller.signal)

    await vi.waitFor(() => {
      expect(worker.writes.map((write) => (write as { method: string }).method)).toEqual(["ready", "queryBatch"])
    })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(worker.child.kill).not.toHaveBeenCalled()
    await runtime.close()
  })

  it("does not allow reuse after close", async () => {
    const worker = createFakeWorker()
    const runtime = new PythonBslRuntime({ spawn: vi.fn(() => worker.child as never), workerPath: "/worker.py" })

    await runtime.queryBatch([bslQuery()])
    await runtime.close()

    await expect(runtime.queryBatch([bslQuery()])).rejects.toThrow("BSL runtime is closed")
  })
})
