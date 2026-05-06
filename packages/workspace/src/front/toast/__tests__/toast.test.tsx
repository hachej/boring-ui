import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react"
import {
  toast,
  Toaster,
  dismissToast,
  getActiveToasts,
  clearToasts,
  subscribeToasts,
  type ToastRecord,
} from ".."

describe("toast (module store)", () => {
  beforeEach(() => {
    clearToasts()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    clearToasts()
  })

  it("toast() pushes a record into the store with default variant=info", () => {
    const id = toast("Hello")
    const records = getActiveToasts()
    expect(records).toHaveLength(1)
    expect(records[0].id).toBe(id)
    expect(records[0].title).toBe("Hello")
    expect(records[0].variant).toBe("info")
  })

  it("toast.success / toast.error / toast.info set the variant", () => {
    toast.success("Saved")
    toast.error("Boom")
    toast.info("FYI")
    const variants = getActiveToasts().map((t: ToastRecord) => t.variant)
    expect(variants).toEqual(["success", "error", "info"])
  })

  it("auto-dismisses after the configured duration", () => {
    toast({ title: "Bye", durationMs: 2000 })
    expect(getActiveToasts()).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(2001)
    })
    expect(getActiveToasts()).toHaveLength(0)
  })

  it("durationMs=0 keeps the toast indefinitely", () => {
    toast({ title: "Sticky", durationMs: 0 })
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(getActiveToasts()).toHaveLength(1)
  })

  it("dismissToast(id) removes a specific toast", () => {
    const id1 = toast("a")
    toast("b")
    dismissToast(id1)
    const left = getActiveToasts()
    expect(left).toHaveLength(1)
    expect(left[0].title).toBe("b")
  })

  it("subscribeToasts notifies listeners on push and dismiss", () => {
    const fn = vi.fn()
    const unsub = subscribeToasts(fn)
    fn.mockClear()
    const id = toast("hi")
    expect(fn).toHaveBeenCalledTimes(1)
    dismissToast(id)
    expect(fn).toHaveBeenCalledTimes(2)
    unsub()
    toast("ignored")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("accepts string or ToastInput", () => {
    toast("just a string")
    toast({ title: "object", description: "details" })
    const records = getActiveToasts()
    expect(records[0].title).toBe("just a string")
    expect(records[1].title).toBe("object")
    expect(records[1].description).toBe("details")
  })
})

describe("<Toaster />", () => {
  beforeEach(() => clearToasts())
  afterEach(() => clearToasts())

  it("renders nothing when there are no toasts", () => {
    render(<Toaster />)
    expect(screen.queryByTestId("toast")).not.toBeInTheDocument()
  })

  it("renders toasts pushed via the toast() module function", async () => {
    render(<Toaster />)
    act(() => {
      toast.success({ title: "Saved", description: "All good" })
    })
    await waitFor(() => {
      expect(screen.getByTestId("toast")).toBeInTheDocument()
    })
    expect(screen.getByText("Saved")).toBeInTheDocument()
    expect(screen.getByText("All good")).toBeInTheDocument()
    expect(screen.getByTestId("toast").getAttribute("data-variant")).toBe(
      "success",
    )
  })

  it("dismiss button removes the toast", async () => {
    render(<Toaster />)
    act(() => {
      toast.error("Boom")
    })
    await waitFor(() => expect(screen.getByText("Boom")).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText("Dismiss"))
    await waitFor(() =>
      expect(screen.queryByText("Boom")).not.toBeInTheDocument(),
    )
  })

  it("renders multiple toasts in push order", async () => {
    render(<Toaster />)
    act(() => {
      toast("first")
      toast("second")
      toast("third")
    })
    await waitFor(() => {
      expect(screen.getAllByTestId("toast")).toHaveLength(3)
    })
    const titles = screen.getAllByTestId("toast").map((el) => el.textContent)
    expect(titles[0]).toContain("first")
    expect(titles[1]).toContain("second")
    expect(titles[2]).toContain("third")
  })
})
