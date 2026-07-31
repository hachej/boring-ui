// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { workspaceSessionKeyFor } from "../../../front/sessionIdentity"
import { useSessionCreationCoordinator } from "../useSessionCreationCoordinator"

interface Row {
  id: string
  agentTypeId?: string
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function keyFor(row: Row): string {
  return workspaceSessionKeyFor(row)
}

describe("useSessionCreationCoordinator", () => {
  it("rechecks ownership inside the deferred invocation and cancels instead of calling the provider", async () => {
    let owned = true
    const create = vi.fn(() => ({ id: "must-not-exist" }))
    const { result, rerender } = renderHook(() => useSessionCreationCoordinator<Row>({
      sourceKey: "source",
      rows: [{ id: "existing" }],
      activeKey: keyFor({ id: "existing" }),
      keyFor,
      hasCanonicalResult: (value) => typeof (value as { id?: unknown } | undefined)?.id === "string",
      ownerIsCurrent: () => owned,
      ownershipReady: owned,
    }))

    let creation!: Promise<unknown>
    act(() => {
      creation = result.current.coordinate({ dedupeKey: "manual", create })
      owned = false
      rerender()
    })

    await expect(creation).resolves.toBeUndefined()
    expect(create).not.toHaveBeenCalled()
  })

  it("does not adopt a row inserted before the deferred provider invocation", async () => {
    let rows: Row[] = [{ id: "existing" }]
    let activeKey = keyFor(rows[0]!)
    const create = vi.fn(() => undefined)
    const { result, rerender } = renderHook(() => useSessionCreationCoordinator<Row>({
      sourceKey: "source",
      rows,
      activeKey,
      keyFor,
      hasCanonicalResult: (value) => typeof (value as { id?: unknown } | undefined)?.id === "string",
      ownerIsCurrent: () => true,
      ownershipReady: true,
      reconciliationTimeoutMs: 1_000,
    }))

    let creation!: Promise<unknown>
    act(() => {
      creation = result.current.coordinate({ dedupeKey: "manual", create })
      rows = [{ id: "unrelated" }, { id: "existing" }]
      activeKey = keyFor(rows[0]!)
      rerender()
    })
    await waitFor(() => expect(create).toHaveBeenCalledOnce())

    let settled = false
    void creation.then(() => { settled = true })
    await act(async () => { await Promise.resolve() })
    expect(settled).toBe(false)

    rows = [{ id: "created" }, ...rows]
    activeKey = keyFor(rows[0]!)
    rerender()
    await expect(creation).resolves.toEqual({ id: "created" })
  })

  it("cancels a settled task on ownership loss so the coordinator is never left occupied", async () => {
    let owned = true
    const gate = deferred<undefined>()
    const firstCreate = vi.fn(() => gate.promise)
    const secondCreate = vi.fn(() => ({ id: "safe" }))
    const { result, rerender } = renderHook(() => useSessionCreationCoordinator<Row>({
      sourceKey: "source",
      rows: [{ id: "existing" }],
      activeKey: keyFor({ id: "existing" }),
      keyFor,
      hasCanonicalResult: (value) => typeof (value as { id?: unknown } | undefined)?.id === "string",
      ownerIsCurrent: () => owned,
      ownershipReady: owned,
    }))

    let first!: Promise<unknown>
    act(() => { first = result.current.coordinate({ dedupeKey: "first", create: firstCreate }) })
    await waitFor(() => expect(firstCreate).toHaveBeenCalledOnce())
    act(() => {
      owned = false
      rerender()
      gate.resolve(undefined)
    })
    await expect(first).resolves.toBeUndefined()

    owned = true
    rerender()
    let second!: Promise<unknown>
    act(() => { second = result.current.coordinate({ dedupeKey: "second", create: secondCreate }) })
    await expect(second).resolves.toEqual({ id: "safe" })
    expect(secondCreate).toHaveBeenCalledOnce()
  })

  it("cancels the old source without carrying its orphan barrier into the new source", async () => {
    let sourceKey = "alpha"
    const oldGate = deferred<{ id: string }>()
    const oldResolved = vi.fn()
    const newCreate = vi.fn(() => ({ id: "beta-created" }))
    const { result, rerender } = renderHook(() => useSessionCreationCoordinator<Row>({
      sourceKey,
      rows: [{ id: `${sourceKey}-existing` }],
      activeKey: keyFor({ id: `${sourceKey}-existing` }),
      keyFor,
      hasCanonicalResult: (value) => typeof (value as { id?: unknown } | undefined)?.id === "string",
      ownerIsCurrent: () => true,
      ownershipReady: true,
    }))

    let old!: Promise<unknown>
    act(() => {
      old = result.current.coordinate({ dedupeKey: "old", create: () => oldGate.promise, onResolved: oldResolved })
    })
    await act(async () => { await Promise.resolve() })

    sourceKey = "beta"
    rerender()
    await expect(old).resolves.toBeUndefined()
    let renewed!: Promise<unknown>
    act(() => { renewed = result.current.coordinate({ dedupeKey: "new", create: newCreate }) })
    await expect(renewed).resolves.toEqual({ id: "beta-created" })

    oldGate.resolve({ id: "alpha-late" })
    await oldGate.promise
    await Promise.resolve()
    expect(oldResolved).not.toHaveBeenCalled()
  })

  it("cancels active and queued tasks during unmount cleanup", async () => {
    const gate = deferred<{ id: string }>()
    const activeSettled = vi.fn()
    const queuedSettled = vi.fn()
    const activeResolved = vi.fn()
    const { result, unmount } = renderHook(() => useSessionCreationCoordinator<Row>({
      sourceKey: "source",
      rows: [{ id: "existing" }],
      activeKey: keyFor({ id: "existing" }),
      keyFor,
      hasCanonicalResult: (value) => typeof (value as { id?: unknown } | undefined)?.id === "string",
      ownerIsCurrent: () => true,
      ownershipReady: true,
    }))

    let active!: Promise<unknown>
    let queued!: Promise<unknown>
    act(() => {
      active = result.current.coordinate({
        dedupeKey: "active",
        create: () => gate.promise,
        onResolved: activeResolved,
        onSettled: activeSettled,
      })
      queued = result.current.coordinate({
        dedupeKey: "queued",
        create: vi.fn(),
        onSettled: queuedSettled,
      })
    })
    await act(async () => { await Promise.resolve() })
    unmount()

    await expect(active).resolves.toBeUndefined()
    await expect(queued).resolves.toBeUndefined()
    expect(activeSettled).toHaveBeenCalledOnce()
    expect(queuedSettled).toHaveBeenCalledOnce()
    gate.resolve({ id: "late" })
    await gate.promise
    await Promise.resolve()
    expect(activeResolved).not.toHaveBeenCalled()
  })

  it("records an ambiguous batch before void transport settlement and never adopts its survivor", async () => {
    let rows: Row[] = [{ id: "existing" }]
    let activeKey = keyFor(rows[0]!)
    const gate = deferred<undefined>()
    const create = vi.fn(() => gate.promise)
    const { result, rerender } = renderHook(() => useSessionCreationCoordinator<Row>({
      sourceKey: "source",
      rows,
      activeKey,
      keyFor,
      hasCanonicalResult: (value) => typeof (value as { id?: unknown } | undefined)?.id === "string",
      ownerIsCurrent: () => true,
      ownershipReady: true,
      reconciliationTimeoutMs: 1_000,
    }))

    let creation!: Promise<unknown>
    act(() => { creation = result.current.coordinate({ dedupeKey: "void", create }) })
    await waitFor(() => expect(create).toHaveBeenCalledOnce())

    rows = [{ id: "first" }, { id: "second" }, { id: "existing" }]
    activeKey = keyFor({ id: "existing" })
    rerender()
    await act(async () => { await Promise.resolve() })

    rows = [{ id: "first" }, { id: "existing" }]
    activeKey = keyFor({ id: "first" })
    rerender()
    act(() => { gate.resolve(undefined) })
    await act(async () => { await gate.promise })

    let settled = false
    void creation.then(() => { settled = true }, () => { settled = true })
    await act(async () => { await Promise.resolve() })
    expect(settled).toBe(false)
    act(() => { result.current.cancel(() => true) })
    await expect(creation).resolves.toBeUndefined()
  })

  it("retains a row-publication barrier when a settled void create is canceled", async () => {
    let rows: Row[] = [{ id: "existing" }]
    let activeKey = keyFor(rows[0]!)
    const create = vi.fn(() => undefined)
    const { result, rerender } = renderHook(() => useSessionCreationCoordinator<Row>({
      sourceKey: "source",
      rows,
      activeKey,
      keyFor,
      hasCanonicalResult: (value) => typeof (value as { id?: unknown } | undefined)?.id === "string",
      ownerIsCurrent: () => true,
      ownershipReady: true,
      reconciliationTimeoutMs: 200,
    }))

    let old!: Promise<unknown>
    act(() => { old = result.current.coordinate({ dedupeKey: "old", create }) })
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    await act(async () => { await Promise.resolve() })
    act(() => { result.current.cancel((task) => task.dedupeKey === "old") })
    await expect(old).resolves.toBeUndefined()

    let renewed!: Promise<unknown>
    act(() => { renewed = result.current.coordinate({ dedupeKey: "renewed", create }) })
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    rows = [{ id: "old-late" }, { id: "existing" }]
    activeKey = keyFor(rows[0]!)
    rerender()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)) })

    rows = [{ id: "safe" }, { id: "old-late" }, { id: "existing" }]
    activeKey = keyFor(rows[0]!)
    rerender()
    await expect(renewed).resolves.toEqual({ id: "safe" })
  })

  it("quarantines a late row after reconciliation timeout", async () => {
    let rows: Row[] = [{ id: "existing" }]
    let activeKey = keyFor(rows[0]!)
    const create = vi.fn(() => undefined)
    const { result, rerender } = renderHook(() => useSessionCreationCoordinator<Row>({
      sourceKey: "source",
      rows,
      activeKey,
      keyFor,
      hasCanonicalResult: (value) => typeof (value as { id?: unknown } | undefined)?.id === "string",
      ownerIsCurrent: () => true,
      ownershipReady: true,
      reconciliationTimeoutMs: 200,
    }))

    let timedOut!: Promise<unknown>
    act(() => { timedOut = result.current.coordinate({ dedupeKey: "timed-out", create }) })
    const timeoutExpectation = expect(timedOut).rejects.toMatchObject({ code: "SESSION_CREATE_RECONCILIATION_TIMEOUT" })
    await timeoutExpectation

    let renewed!: Promise<unknown>
    act(() => { renewed = result.current.coordinate({ dedupeKey: "renewed", create }) })
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    rows = [{ id: "timed-out-late" }, { id: "existing" }]
    activeKey = keyFor(rows[0]!)
    rerender()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)) })

    rows = [{ id: "safe" }, { id: "timed-out-late" }, { id: "existing" }]
    activeKey = keyFor(rows[0]!)
    rerender()
    await expect(renewed).resolves.toEqual({ id: "safe" })
  })

  it("preserves the orphan barrier across disable and reenable of the same source", async () => {
    let rows: Row[] = [{ id: "existing" }]
    let activeKey = keyFor(rows[0]!)
    let ready = true
    const create = vi.fn(() => undefined)
    const { result, rerender } = renderHook(() => useSessionCreationCoordinator<Row>({
      sourceKey: "stable-source",
      rows,
      activeKey,
      keyFor,
      hasCanonicalResult: (value) => typeof (value as { id?: unknown } | undefined)?.id === "string",
      ownerIsCurrent: () => ready,
      ownershipReady: ready,
      reconciliationTimeoutMs: 200,
    }))

    let old!: Promise<unknown>
    act(() => { old = result.current.coordinate({ dedupeKey: "old", create }) })
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    await act(async () => { await Promise.resolve() })
    ready = false
    rerender()
    await expect(old).resolves.toBeUndefined()

    ready = true
    rerender()
    let renewed!: Promise<unknown>
    act(() => { renewed = result.current.coordinate({ dedupeKey: "renewed", create }) })
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    rows = [{ id: "disabled-epoch-late" }, { id: "existing" }]
    activeKey = keyFor(rows[0]!)
    rerender()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)) })

    rows = [{ id: "safe" }, { id: "disabled-epoch-late" }, { id: "existing" }]
    activeKey = keyFor(rows[0]!)
    rerender()
    await expect(renewed).resolves.toEqual({ id: "safe" })
  })

  it("holds renewed void attribution through late transport settlement and its publication horizon", async () => {
    let rows: Row[] = [{ id: "existing" }]
    let activeKey = keyFor(rows[0]!)
    const oldGate = deferred<undefined>()
    const oldCreate = vi.fn(() => oldGate.promise)
    const renewedCreate = vi.fn(() => undefined)
    const { result, rerender } = renderHook(() => useSessionCreationCoordinator<Row>({
      sourceKey: "source",
      rows,
      activeKey,
      keyFor,
      hasCanonicalResult: (value) => typeof (value as { id?: unknown } | undefined)?.id === "string",
      ownerIsCurrent: () => true,
      ownershipReady: true,
      reconciliationTimeoutMs: 200,
    }))

    let old!: Promise<unknown>
    act(() => { old = result.current.coordinate({ dedupeKey: "auto-submit:1", create: oldCreate }) })
    await waitFor(() => expect(oldCreate).toHaveBeenCalledOnce())
    act(() => { result.current.cancel((task) => task.dedupeKey === "auto-submit:1") })
    await expect(old).resolves.toBeUndefined()

    let renewed!: Promise<unknown>
    act(() => { renewed = result.current.coordinate({ dedupeKey: "auto-submit:2", create: renewedCreate }) })
    await waitFor(() => expect(renewedCreate).toHaveBeenCalledOnce())

    rows = [{ id: "renewed-overlap" }, { id: "old-late" }, { id: "existing" }]
    activeKey = keyFor(rows[0]!)
    rerender()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)) })

    let settled = false
    void renewed.then(() => { settled = true })
    await act(async () => { await Promise.resolve() })
    expect(settled).toBe(false)

    act(() => { oldGate.resolve(undefined) })
    await act(async () => { await oldGate.promise })
    rows = [{ id: "old-late" }, { id: "existing" }]
    activeKey = keyFor(rows[0]!)
    rerender()
    await act(async () => { await Promise.resolve() })

    await act(async () => { await Promise.resolve() })
    expect(settled).toBe(false)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)) })

    rows = [{ id: "safe-after-overlap" }, { id: "old-late" }, { id: "existing" }]
    activeKey = keyFor(rows[0]!)
    rerender()
    await expect(renewed).resolves.toEqual({ id: "safe-after-overlap" })
  })
})
