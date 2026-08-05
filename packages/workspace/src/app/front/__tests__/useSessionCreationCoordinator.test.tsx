// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { StrictMode, type PropsWithChildren } from "react"
import { describe, expect, it, vi } from "vitest"
import { SESSION_CREATE_PROTOCOL_ERROR } from "../../../front/sessionCreateProtocol"
import { useSessionCreationCoordinator } from "../useSessionCreationCoordinator"

interface Session { id: string; agentTypeId?: string }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((nextResolve) => { resolve = nextResolve }); return { promise, resolve } }
function validateResult(value: unknown): Session {
  if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string") {
    throw Object.assign(new Error("create did not return a canonical session"), { code: SESSION_CREATE_PROTOCOL_ERROR })
  }
  return value as Session
}

describe("useSessionCreationCoordinator", () => {
  it("creates successfully after the StrictMode effect replay", async () => {
    const create = vi.fn(() => ({ id: "strict-created" }))
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>
    const { result } = renderHook(() => useSessionCreationCoordinator<Session>({ sourceKey: "source", validateResult, ownerIsCurrent: () => true, ownershipReady: true }), { wrapper })
    let creation!: Promise<Session | undefined>
    act(() => { creation = result.current.coordinate({ dedupeKey: "strict", create }) })
    await expect(creation).resolves.toEqual({ id: "strict-created" })
    expect(create).toHaveBeenCalledOnce()
  })

  it("rechecks ownership at the deferred invocation boundary", async () => {
    let owned = true
    const create = vi.fn(() => ({ id: "must-not-exist" }))
    const { result, rerender } = renderHook(() => useSessionCreationCoordinator<Session>({ sourceKey: "source", validateResult, ownerIsCurrent: () => owned, ownershipReady: owned }))
    let creation!: Promise<Session | undefined>
    act(() => { creation = result.current.coordinate({ dedupeKey: "manual", create }); owned = false; rerender() })
    await expect(creation).resolves.toBeUndefined()
    expect(create).not.toHaveBeenCalled()
  })

  it("serializes canonical creates for one source", async () => {
    const gate = deferred<Session>()
    const firstCreate = vi.fn(() => gate.promise)
    const secondCreate = vi.fn(() => ({ id: "second" }))
    const { result } = renderHook(() => useSessionCreationCoordinator<Session>({ sourceKey: "source", validateResult, ownerIsCurrent: () => true, ownershipReady: true }))
    let first!: Promise<Session | undefined>; let second!: Promise<Session | undefined>
    act(() => { first = result.current.coordinate({ dedupeKey: "first", create: firstCreate }); second = result.current.coordinate({ dedupeKey: "second", create: secondCreate }) })
    await waitFor(() => expect(firstCreate).toHaveBeenCalledOnce())
    expect(secondCreate).not.toHaveBeenCalled()
    act(() => gate.resolve({ id: "first" }))
    await expect(first).resolves.toEqual({ id: "first" })
    await expect(second).resolves.toEqual({ id: "second" })
    expect(secondCreate).toHaveBeenCalledOnce()
  })

  it("fails an undefined custom result cleanly and permits retry", async () => {
    const invalidCreate = vi.fn((() => undefined) as unknown as () => Session)
    const retryCreate = vi.fn(() => ({ id: "retry" }))
    const { result } = renderHook(() => useSessionCreationCoordinator<Session>({ sourceKey: "source", validateResult, ownerIsCurrent: () => true, ownershipReady: true }))
    let invalid!: Promise<Session | undefined>
    act(() => { invalid = result.current.coordinate({ dedupeKey: "invalid", create: invalidCreate }) })
    await expect(invalid).rejects.toMatchObject({ code: "SESSION_CREATE_PROTOCOL_ERROR" })
    let retry!: Promise<Session | undefined>
    act(() => { retry = result.current.coordinate({ dedupeKey: "retry", create: retryCreate }) })
    await expect(retry).resolves.toEqual({ id: "retry" })
    expect(retryCreate).toHaveBeenCalledOnce()
  })

  it("cancels the old source and ignores its late canonical settlement", async () => {
    let sourceKey = "alpha"
    const oldGate = deferred<Session>(); const oldResolved = vi.fn(); const newCreate = vi.fn(() => ({ id: "beta-created", agentTypeId: "beta" }))
    const { result, rerender } = renderHook(() => useSessionCreationCoordinator<Session>({ sourceKey, validateResult, ownerIsCurrent: () => true, ownershipReady: true }))
    let old!: Promise<Session | undefined>
    act(() => { old = result.current.coordinate({ dedupeKey: "old", create: () => oldGate.promise, onResolved: oldResolved }) })
    await waitFor(() => expect(result.current).toBeDefined()); await act(async () => { await Promise.resolve() })
    sourceKey = "beta"; rerender(); await expect(old).resolves.toBeUndefined()
    let current!: Promise<Session | undefined>
    act(() => { current = result.current.coordinate({ dedupeKey: "new", create: newCreate }) })
    await expect(current).resolves.toEqual({ id: "beta-created", agentTypeId: "beta" })
    act(() => oldGate.resolve({ id: "alpha-late", agentTypeId: "alpha" })); await oldGate.promise; await act(async () => { await Promise.resolve() })
    expect(oldResolved).not.toHaveBeenCalled()
  })

  it("cancels active and queued tasks on withdrawal and unmount", async () => {
    const gate = deferred<Session>(); const activeResolved = vi.fn(); const queuedCreate = vi.fn(() => ({ id: "queued" }))
    const { result, unmount } = renderHook(() => useSessionCreationCoordinator<Session>({ sourceKey: "source", validateResult, ownerIsCurrent: () => true, ownershipReady: true }))
    let active!: Promise<Session | undefined>; let queued!: Promise<Session | undefined>
    act(() => { active = result.current.coordinate({ dedupeKey: "auto-submit:1", create: () => gate.promise, onResolved: activeResolved }); queued = result.current.coordinate({ dedupeKey: "manual", create: queuedCreate }) })
    await act(async () => { await Promise.resolve() }); act(() => result.current.cancel(() => true))
    await expect(active).resolves.toBeUndefined(); await expect(queued).resolves.toBeUndefined(); expect(queuedCreate).not.toHaveBeenCalled(); unmount()
    gate.resolve({ id: "late" }); await gate.promise; await act(async () => { await Promise.resolve() }); expect(activeResolved).not.toHaveBeenCalled()
  })
})
