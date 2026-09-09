import { createRef } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { FetchError, type FetchClient } from "../../data/fetchClient"
import { FileTreeUploadManager, type FileTreeUploadManagerHandle } from "../upload/FileTreeUploadManager"

function file(name: string, content = "x") {
  return new File([content], name, { type: "text/plain" })
}

function setup(writeBinaryFile = vi.fn(), onWritten = vi.fn(async () => {})) {
  const ref = createRef<FileTreeUploadManagerHandle>()
  const client = { writeBinaryFile } as unknown as FetchClient
  render(<FileTreeUploadManager ref={ref} client={client} enabled onWritten={onWritten} />)
  act(() => ref.current?.open("src"))
  const choose = (...files: File[]) => fireEvent.change(screen.getByLabelText("Choose files to upload"), { target: { files } })
  return { ref, choose, writeBinaryFile, onWritten }
}

beforeEach(() => vi.clearAllMocks())

describe("FileTreeUploadManager", () => {
  it("rejects files over 10 MiB without calling the transport", async () => {
    const { choose, writeBinaryFile } = setup()
    choose(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.bin"))
    fireEvent.click(await screen.findByRole("button", { name: "1 failed" }))
    expect(screen.getByText("File exceeds the 10 MiB limit.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Retry large.bin" })).not.toBeInTheDocument()
    expect(writeBinaryFile).not.toHaveBeenCalled()
  })

  it("bounds independent uploads at three concurrent requests", async () => {
    let active = 0
    let maximum = 0
    const releases: Array<() => void> = []
    const write = vi.fn(async (path: string) => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active -= 1
      return { status: "written" as const, path }
    })
    const { choose } = setup(write)
    choose(...Array.from({ length: 5 }, (_, index) => file(`${index}.txt`)))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(3))
    expect(maximum).toBe(3)
    act(() => releases.splice(0).forEach((release) => release()))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(5))
    act(() => releases.splice(0).forEach((release) => release()))
    await waitFor(() => expect(screen.getByText("5 uploaded")).toBeInTheDocument())
  })

  it("orders duplicate destination paths while allowing other paths in parallel", async () => {
    let releaseFirst!: () => void
    const first = new Promise<void>((resolve) => { releaseFirst = resolve })
    const write = vi.fn(async (path: string) => {
      if (path === "src/same.txt" && write.mock.calls.filter(([called]) => called === path).length === 1) await first
      return { status: "written" as const, path }
    })
    const { choose } = setup(write)
    choose(file("same.txt", "first"), file("same.txt", "second"), file("other.txt"))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(write.mock.calls.map(([path]) => path)).toEqual(["src/same.txt", "src/other.txt"])
    releaseFirst()
    await waitFor(() => expect(write).toHaveBeenCalledTimes(3))
    expect(write.mock.calls[2]?.[0]).toBe("src/same.txt")
  })

  it("uploads non-conflicts first, then replaces only authoritative conflicts", async () => {
    const write = vi.fn(async (path: string, _file: File, options: { ifExists: string }) =>
      options.ifExists === "error" && path.endsWith("exists.txt")
        ? { status: "conflict" as const, path, reason: "already-exists" as const }
        : { status: "written" as const, path })
    const { choose, onWritten } = setup(write)
    choose(file("fresh.txt"), file("exists.txt"))
    await screen.findByText(/Files without conflicts have already been uploaded/)
    expect(onWritten).toHaveBeenCalledWith(["src"])
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(3))
    expect(write.mock.calls[2]?.[2]).toMatchObject({ ifExists: "replace" })
    await waitFor(() => expect(screen.getByText("2 uploaded")).toBeInTheDocument())
  })

  it.each([
    ["Skip existing", "A file with this name already exists.", /1 uploaded, 1 skipped/],
    ["Cancel remaining", "Upload canceled after other files completed.", /1 uploaded, 1 canceled/],
  ])("applies %s only to unresolved conflicts", async (action, message, summary) => {
    const write = vi.fn(async (path: string) => path.endsWith("exists.txt")
      ? { status: "conflict" as const, path, reason: "already-exists" as const }
      : { status: "written" as const, path })
    const { choose } = setup(write)
    choose(file("fresh.txt"), file("exists.txt"))
    await screen.findByRole("button", { name: action })
    fireEvent.click(screen.getByRole("button", { name: action }))
    fireEvent.click(await screen.findByRole("button", { name: summary }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByText(action === "Cancel remaining" ? "canceled" : "skipped")).toBeInTheDocument()
    expect(write).toHaveBeenCalledTimes(2)
  })

  it("retries through the authoritative first pass and can surface a later conflict", async () => {
    const write = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ status: "conflict", path: "src/retry.txt", reason: "already-exists" })
    const { choose } = setup(write)
    choose(file("retry.txt"))
    fireEvent.click(await screen.findByRole("button", { name: "1 failed" }))
    fireEvent.click(screen.getByRole("button", { name: "Retry retry.txt" }))
    expect(await screen.findByRole("button", { name: "Cancel remaining" })).toBeInTheDocument()
    expect(write.mock.calls[1]?.[2]).toMatchObject({ ifExists: "error" })
  })

  it.each([400, 403, 404, 501])("does not offer retry for deterministic HTTP %s failures", async (status) => {
    const write = vi.fn().mockRejectedValue(new FetchError(status, `HTTP ${status}`))
    const { choose } = setup(write)
    choose(file("blocked.txt"))
    fireEvent.click(await screen.findByRole("button", { name: "1 failed" }))
    expect(screen.queryByRole("button", { name: "Retry blocked.txt" })).not.toBeInTheDocument()
  })

  it("aborts an active transport when unmounted", async () => {
    let signal: AbortSignal | undefined
    const write = vi.fn(async (_path: string, _file: File, options: { signal: AbortSignal }) => {
      signal = options.signal
      await new Promise(() => {})
      return { status: "written" as const, path: "never" }
    })
    const ref = createRef<FileTreeUploadManagerHandle>()
    const { unmount } = render(<FileTreeUploadManager ref={ref} client={{ writeBinaryFile: write } as unknown as FetchClient} enabled onWritten={vi.fn()} />)
    act(() => ref.current?.open("."))
    fireEvent.change(screen.getByLabelText("Choose files to upload"), { target: { files: [file("active.txt")] } })
    await waitFor(() => expect(signal).toBeDefined())
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
