import { describe, expect, it, vi } from "vitest"
import { WorkspacePluginClientRequestError } from "@hachej/boring-workspace"
import { createTLStore, type Editor } from "tldraw"
import { applyCanvasAction, applyCanvasBatch, createSerializedSaveQueue, flushPendingSaveOnClose, loadCanvasStoreSnapshot, reconcileFailedSave } from "../panels"

function editorFixture() {
  const before = { store: { "shape:before": {} }, schema: {} }
  const loadSnapshot = vi.fn()
  const mergeRemoteChanges = vi.fn((fn: () => void) => fn())
  const deleteShapes = vi.fn()
  const bailToMark = vi.fn()
  const clearHistory = vi.fn()
  const editor = {
    store: { getStoreSnapshot: vi.fn(() => before), mergeRemoteChanges },
    loadSnapshot,
    clearHistory,
    markHistoryStoppingPoint: vi.fn(() => "mark:batch"),
    bailToMark,
    run: (fn: () => void) => fn(),
    getCurrentPageShapeIds: () => new Set(["shape:before"]),
    deleteShapes,
    getShape: vi.fn(() => undefined),
    getInstanceState: () => ({ isReadonly: false }),
    updateInstanceState: vi.fn(),
  } as unknown as Editor
  return { editor, before, loadSnapshot, mergeRemoteChanges, bailToMark, clearHistory, deleteShapes }
}

const batch = { id: "batch", path: "flow.tldraw", filesystem: "user" as const, actions: [{ type: "clear" as const }] }

describe("applyCanvasBatch", () => {
  it("preserves omitted properties during a partial update", () => {
    const updateShape = vi.fn()
    const editor = {
      getShape: vi.fn(() => ({ id: "shape:a", type: "geo", x: 10, y: 20, props: { w: 100, h: 50, color: "blue" } })),
      updateShape,
    } as unknown as Editor
    applyCanvasAction(editor, { type: "update", shape: { id: "a", target: "geo", x: 30, color: "red" } })
    expect(updateShape).toHaveBeenCalledWith({ id: "shape:a", type: "geo", x: 30, props: { color: "red" } })
  })

  it("serializes overlapping saves and preserves edits arriving during a delayed commit", async () => {
    let snapshotVersion = 1
    let release!: () => void
    const commits: Array<{ json: string; generation: number }> = []
    const queue = createSerializedSaveQueue({
      snapshot: async () => `snapshot-${snapshotVersion}`,
      commit: async (json, generation) => {
        commits.push({ json, generation })
        if (generation === 1) await new Promise<void>((resolve) => { release = resolve })
      },
    })
    queue.markDirty()
    const first = queue.flush()
    await vi.waitFor(() => expect(commits).toHaveLength(1))
    snapshotVersion = 2
    queue.markDirty()
    const overlapping = queue.flush()
    expect(overlapping).toBe(first)
    release()
    await overlapping
    expect(commits).toEqual([
      { json: "snapshot-1", generation: 1 },
      { json: "snapshot-2", generation: 2 },
    ])
    expect(queue.hasDirty()).toBe(false)
  })

  it("retries the exact ambiguous generation before saving a later edit", async () => {
    let snapshotVersion = 1
    let calls = 0
    const commits: Array<{ json: string; generation: number }> = []
    const queue = createSerializedSaveQueue({
      snapshot: async () => `snapshot-${snapshotVersion}`,
      commit: async (json, generation) => {
        commits.push({ json, generation })
        calls += 1
        if (calls === 1) throw new Error("lost response")
      },
    })
    queue.markDirty()
    await expect(queue.flush()).rejects.toThrow("lost response")
    snapshotVersion = 2
    queue.markDirty()
    await queue.flush()
    expect(commits).toEqual([
      { json: "snapshot-1", generation: 1 },
      { json: "snapshot-1", generation: 1 },
      { json: "snapshot-2", generation: 2 },
    ])
  })

  it("preserves a newer generation after a delayed definite conflict", async () => {
    let snapshotVersion = 1
    let rejectFirst!: (error: Error) => void
    const commits: Array<{ json: string; generation: number }> = []
    const queue = createSerializedSaveQueue({
      snapshot: async () => `snapshot-${snapshotVersion}`,
      commit: async (json, generation) => {
        commits.push({ json, generation })
        if (generation === 1) await new Promise<void>((_resolve, reject) => { rejectFirst = reject })
      },
    })
    queue.markDirty()
    const first = queue.flush()
    await vi.waitFor(() => expect(commits).toHaveLength(1))
    snapshotVersion = 2
    queue.markDirty()
    rejectFirst(new WorkspacePluginClientRequestError("conflict", 409, { written: false }))
    await expect(first).rejects.toThrow("conflict")
    const failedGeneration = queue.pendingGeneration()
    expect(failedGeneration).toBe(1)
    expect(queue.currentGeneration()).toBe(2)
    const reload = vi.fn(async (_applySnapshot: boolean) => {})
    await expect(reconcileFailedSave(queue, failedGeneration!, reload)).resolves.toBe(true)
    expect(reload).toHaveBeenCalledWith(false)
    await queue.flush()
    expect(commits).toEqual([
      { json: "snapshot-1", generation: 1 },
      { json: "snapshot-2", generation: 2 },
    ])
    expect(queue.hasDirty()).toBe(false)
  })

  it("applies durable reload when a failed save has no newer local generation", async () => {
    const queue = createSerializedSaveQueue({ snapshot: async () => "snapshot", commit: async () => { throw new Error("conflict") } })
    queue.markDirty()
    await expect(queue.flush()).rejects.toThrow("conflict")
    const reload = vi.fn(async (_applySnapshot: boolean) => {})
    await expect(reconcileFailedSave(queue, queue.pendingGeneration()!, reload)).resolves.toBe(false)
    expect(reload).toHaveBeenCalledWith(true)
    expect(queue.hasDirty()).toBe(false)
  })

  it("marks SDK remote merges as remote rather than user changes", () => {
    const store = createTLStore()
    const userChanges = vi.fn()
    const page = {
      id: "page:test",
      typeName: "page",
      name: "Page",
      index: "a1",
      meta: {},
    }
    store.put([page as never])
    ;(store as unknown as { ensureStoreIsUsable(): void }).ensureStoreIsUsable()
    store.listen(userChanges, { scope: "document", source: "user" })
    store.mergeRemoteChanges(() => { store.put([{ ...page, name: "remote" } as never]) })
    expect(userChanges).not.toHaveBeenCalled()
    store.put([{ ...page, name: "manual" } as never])
    expect(userChanges).toHaveBeenCalledOnce()
  })

  it("flushes a dirty generation when the pane closes before its debounce", async () => {
    const commit = vi.fn(async () => {})
    const queue = createSerializedSaveQueue({ snapshot: async () => "closing", commit })
    queue.markDirty()
    await flushPendingSaveOnClose(queue, window.setTimeout(() => {}, 500))
    expect(commit).toHaveBeenCalledWith("closing", 1)
  })

  it("loads a native document through the canonical editor API as a remote change", () => {
    const fixture = editorFixture()
    const snapshot = { store: {}, schema: {} } as never
    loadCanvasStoreSnapshot(fixture.editor, snapshot)
    expect(fixture.mergeRemoteChanges).toHaveBeenCalledOnce()
    expect(fixture.loadSnapshot).toHaveBeenCalledWith(snapshot)
    expect(fixture.clearHistory).toHaveBeenCalledOnce()
  })

  it("rolls back a partially applied local batch even when reload would fail", async () => {
    const fixture = editorFixture()
    const invalidBatch = { ...batch, actions: [{ type: "clear" as const }, { type: "delete" as const, ids: ["missing"] }] }
    const reload = vi.fn(async () => { throw new Error("reload failed") })
    const commit = vi.fn(async () => {})
    await expect(applyCanvasBatch({ editor: fixture.editor, batch: invalidBatch, commit, reload })).rejects.toThrow("missing shapes")
    expect(fixture.bailToMark).toHaveBeenCalledWith("mark:batch")
    expect(commit).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it("applies all actions before committing once", async () => {
    const fixture = editorFixture()
    const commit = vi.fn(async () => {})
    await applyCanvasBatch({ editor: fixture.editor, batch, commit, reload: vi.fn(async () => {}) })
    expect(fixture.deleteShapes).toHaveBeenCalledOnce()
    expect(fixture.mergeRemoteChanges).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledOnce()
    expect(fixture.clearHistory).toHaveBeenCalledOnce()
  })

  it("rolls back only when the server definitively reports not written", async () => {
    const fixture = editorFixture()
    const error = new WorkspacePluginClientRequestError("conflict", 409, { written: false })
    await expect(applyCanvasBatch({ editor: fixture.editor, batch, commit: async () => { throw error }, reload: vi.fn(async () => {}) })).rejects.toBe(error)
    expect(fixture.bailToMark).toHaveBeenCalledWith("mark:batch")
  })

  it("restores the pre-batch snapshot when ambiguous recovery reload also fails", async () => {
    const fixture = editorFixture()
    const reload = vi.fn(async () => { throw new Error("reload failed") })
    await expect(applyCanvasBatch({ editor: fixture.editor, batch, commit: async () => { throw new Error("network") }, reload })).rejects.toThrow("network")
    expect(reload).toHaveBeenCalledOnce()
    expect(fixture.bailToMark).toHaveBeenCalledWith("mark:batch")
  })

  it("reloads instead of rolling back after an ambiguous failure", async () => {
    const fixture = editorFixture()
    const reload = vi.fn(async () => {})
    await expect(applyCanvasBatch({ editor: fixture.editor, batch, commit: async () => { throw new Error("network") }, reload })).rejects.toThrow("network")
    expect(reload).toHaveBeenCalledOnce()
    expect(fixture.bailToMark).not.toHaveBeenCalled()
  })
})
