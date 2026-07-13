// Vitest setup shared by server (node) and front (jsdom) tests. See the
// canonical note in plugins/data-catalog/src/test-setup.ts: extend expect with
// jest-dom matchers manually so both sides pin the same `vitest` copy. DOM-only
// hooks are guarded so this file is a no-op under the node environment used by
// the server tests.
import { expect, afterEach } from "vitest"
import * as matchers from "@testing-library/jest-dom/matchers"
import { cleanup } from "@testing-library/react"

expect.extend(matchers)

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

afterEach(() => {
  if (typeof document !== "undefined") cleanup()
})
