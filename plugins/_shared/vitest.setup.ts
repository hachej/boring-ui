// Shared vitest setup for plugins under plugins/*.
//
// Extends vitest's `expect` with jest-dom matchers manually rather than
// via `import "@testing-library/jest-dom/vitest"`. The shorthand
// re-imports `vitest` through jest-dom's own resolution path, which —
// after lockfile churn in this monorepo — lands on a *different* copy
// of vitest than test files do. Extensions go nowhere and you get
// `Invalid Chai property: toBeInTheDocument` everywhere. Doing the
// extend manually pins both sides to the same expect.
import { expect, afterEach } from "vitest"
import * as matchers from "@testing-library/jest-dom/matchers"
import { cleanup } from "@testing-library/react"

expect.extend(matchers)

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom doesn't implement layout. Plugins using tiptap / ProseMirror
// call getClientRects on Range/Element instances during scrollIntoView;
// stub them so transactions don't throw.
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function () {
    return { length: 0, item: () => null, [Symbol.iterator]: function* () {} } as any
  }
  Range.prototype.getBoundingClientRect = function () {
    return {
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0,
      width: 0, height: 0, toJSON: () => ({}),
    } as DOMRect
  }
}

afterEach(() => {
  cleanup()
})
