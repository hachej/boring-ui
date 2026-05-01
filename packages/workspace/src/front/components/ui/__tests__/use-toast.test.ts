import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { clearToasts, getActiveToasts } from "../../../toast"
import { useToast } from "../use-toast"

describe("useToast", () => {
  beforeEach(() => {
    clearToasts()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    clearToasts()
  })

  it("dispatches string toasts synchronously", () => {
    const { toast } = useToast()

    toast("Saved")

    expect(getActiveToasts()).toMatchObject([
      { title: "Saved", variant: "info" },
    ])
  })

  it("maps shadcn variants onto workspace toast variants", () => {
    const { toast } = useToast()

    toast({ title: "Default", variant: "default", durationMs: 0 })
    toast({ title: "Destructive", variant: "destructive", durationMs: 0 })
    toast({ title: "Success", variant: "success", durationMs: 0 })

    expect(getActiveToasts()).toMatchObject([
      { title: "Default", variant: "info" },
      { title: "Destructive", variant: "error" },
      { title: "Success", variant: "success" },
    ])
  })
})
