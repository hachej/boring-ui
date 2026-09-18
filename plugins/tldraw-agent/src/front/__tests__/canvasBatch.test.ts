import React from "react"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { WorkspacePluginClientRequestError } from "@hachej/boring-workspace"
import { createTLStore, Tldraw, type Editor } from "tldraw"
import { applyCanvasAction, applyCanvasBatch, createCanvasLeaseGuard, createCanvasReadinessGate, createSerializedSaveQueue, flushPendingSaveOnClose, loadCanvasStoreSnapshot, reconcileFailedSave, setCanvasOwnership } from "../panels"

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
  it("mutates a real SDK editor while owned and is relocked before async commit", async () => {
    if (!(Image.prototype as { decode?: () => Promise<void> }).decode) {
      Object.defineProperty(Image.prototype, "decode", { configurable: true, value: async () => {} })
    }
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    })
    Object.defineProperty(globalThis, "FontFace", {
      configurable: true,
      value: class TestFontFace {
        status = "loaded"
        constructor(public family: string) {}
        async load() { return this }
      },
    })
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready: Promise.resolve(), add() {}, delete() { return true }, has() { return false },
        check() { return true }, async load() { return [] }, *[Symbol.iterator]() {},
      },
    })
    let editor: Editor | undefined
    render(React.createElement(Tldraw, { onMount: (mounted: Editor) => { editor = mounted } }))
    await waitFor(() => expect(editor).toBeDefined())
    const createBatch = {
      id: "real-batch",
      path: "flow.tldraw",
      filesystem: "user" as const,
      actions: [{ type: "create" as const, shape: { id: "real", type: "rectangle" as const, x: 10, y: 20, text: "Real" } }],
    }
    let readonlyAtCommit = false
    await act(async () => {
      setCanvasOwnership(editor!, true)
      await applyCanvasBatch({
        editor: editor!,
        batch: createBatch,
        commit: async () => {
          setCanvasOwnership(editor!, false)
          readonlyAtCommit = editor!.getInstanceState().isReadonly
        },
        reload: async () => {},
      })
    })
    expect(editor!.getShape("shape:real" as never)).toBeDefined()
    expect(readonlyAtCommit).toBe(true)
    cleanup()
  })

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

  it("loads durable external state and enters conflict recovery after a delayed conflict", async () => {
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
    const durableShapes = new Set(["external-shape"])
    const editorShapes = new Set(["stale-local-shape"])
    const reload = vi.fn(async (applySnapshot: boolean) => {
      if (applySnapshot) {
        editorShapes.clear()
        for (const shape of durableShapes) editorShapes.add(shape)
      }
    })
    await expect(reconcileFailedSave(queue, failedGeneration!, reload)).resolves.toBe(true)
    expect(reload).toHaveBeenCalledWith(true)
    expect(editorShapes).toEqual(durableShapes)
    expect(commits).toEqual([{ json: "snapshot-1", generation: 1 }])
    expect(queue.hasDirty()).toBe(false)
  })

  it("blocks drain and edits until the delayed load lifecycle is ready", async () => {
    const gate = createCanvasReadinessGate()
    let release!: () => void
    const delayedLoad = new Promise<void>((resolve) => { release = resolve })
    const claimed = vi.fn()
    const editAccepted = vi.fn()
    const tryWork = () => {
      if (!gate.isReady()) return
      claimed()
      editAccepted()
    }
    tryWork()
    expect(claimed).not.toHaveBeenCalled()
    const loading = delayedLoad.then(() => gate.markReady())
    tryWork()
    expect(editAccepted).not.toHaveBeenCalled()
    release()
    await loading
    tryWork()
    expect(claimed).toHaveBeenCalledOnce()
    expect(editAccepted).toHaveBeenCalledOnce()
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

  it("restores the exact real-store records after a partial remote batch failure without clearing user history", async () => {
    const store = createTLStore()
    const page = { id: "page:test", typeName: "page", name: "Page", index: "a1", meta: {} }
    store.put([page as never])
    ;(store as unknown as { ensureStoreIsUsable(): void }).ensureStoreIsUsable()
    const before = store.getStoreSnapshot()
    const clearHistory = vi.fn()
    const userHistory = ["manual-user-edit"]
    const editor = {
      store,
      loadSnapshot: (snapshot: typeof before) => store.loadStoreSnapshot(snapshot),
      clearHistory,
      getInstanceState: () => ({ isReadonly: false }),
      updateInstanceState: vi.fn(),
      run: (fn: () => void) => fn(),
      getCurrentPageShapeIds: () => new Set(["page:test"]),
      deleteShapes: (ids: string[]) => store.remove(ids as never),
      getShape: vi.fn(() => undefined),
    } as unknown as Editor
    const invalidBatch = { ...batch, actions: [{ type: "clear" as const }, { type: "delete" as const, ids: ["missing"] }] }
    await expect(applyCanvasBatch({ editor, batch: invalidBatch, commit: vi.fn(async () => {}), reload: vi.fn(async () => {}) })).rejects.toThrow("missing shapes")
    expect(store.getStoreSnapshot()).toEqual(before)
    expect(userHistory).toEqual(["manual-user-edit"])
    expect(clearHistory).not.toHaveBeenCalled()
  })

  it("applies all actions before committing once and preserves prior user undo history", async () => {
    const fixture = editorFixture()
    const commit = vi.fn(async () => {})
    await applyCanvasBatch({ editor: fixture.editor, batch, commit, reload: vi.fn(async () => {}) })
    expect(fixture.deleteShapes).toHaveBeenCalledOnce()
    expect(fixture.mergeRemoteChanges).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledOnce()
    expect(fixture.editor.updateInstanceState).not.toHaveBeenCalled()
    expect(fixture.clearHistory).not.toHaveBeenCalled()
    expect(fixture.bailToMark).not.toHaveBeenCalled()
  })

  it("restores the pre-batch snapshot when the server definitively reports not written", async () => {
    const fixture = editorFixture()
    const error = new WorkspacePluginClientRequestError("conflict", 409, { written: false })
    await expect(applyCanvasBatch({ editor: fixture.editor, batch, commit: async () => { throw error }, reload: vi.fn(async () => {}) })).rejects.toBe(error)
    expect(fixture.loadSnapshot).toHaveBeenCalledWith(fixture.before)
  })

  it("restores the pre-batch snapshot when ambiguous recovery reload also fails", async () => {
    const fixture = editorFixture()
    const reload = vi.fn(async () => { throw new Error("reload failed") })
    await expect(applyCanvasBatch({ editor: fixture.editor, batch, commit: async () => { throw new Error("network") }, reload })).rejects.toThrow("network")
    expect(reload).toHaveBeenCalledOnce()
    expect(fixture.loadSnapshot).toHaveBeenCalledWith(fixture.before)
  })

  it("relocks locally when the ownership lease expires", () => {
    vi.useFakeTimers()
    const updateInstanceState = vi.fn()
    const expired = vi.fn()
    const editor = { updateInstanceState } as unknown as Editor
    const guard = createCanvasLeaseGuard(editor, expired)
    guard.grant(5_000)
    expect(guard.isActive()).toBe(true)
    expect(updateInstanceState).toHaveBeenLastCalledWith({ isReadonly: false }, { history: "ignore" })
    vi.advanceTimersByTime(5_000)
    expect(guard.isActive()).toBe(false)
    expect(updateInstanceState).toHaveBeenLastCalledWith({ isReadonly: true }, { history: "ignore" })
    expect(expired).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it("keeps non-owners read-only and unlocks only the owning client", () => {
    const updateInstanceState = vi.fn()
    const editor = { updateInstanceState } as unknown as Editor
    setCanvasOwnership(editor, false)
    setCanvasOwnership(editor, true)
    expect(updateInstanceState).toHaveBeenNthCalledWith(1, { isReadonly: true }, { history: "ignore" })
    expect(updateInstanceState).toHaveBeenNthCalledWith(2, { isReadonly: false }, { history: "ignore" })
  })

  it("reloads instead of rolling back after an ambiguous failure", async () => {
    const fixture = editorFixture()
    const reload = vi.fn(async () => {})
    await expect(applyCanvasBatch({ editor: fixture.editor, batch, commit: async () => { throw new Error("network") }, reload })).rejects.toThrow("network")
    expect(reload).toHaveBeenCalledOnce()
    expect(fixture.bailToMark).not.toHaveBeenCalled()
  })
})
