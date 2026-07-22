// Extend vitest's `expect` with jest-dom matchers, importing `expect`
// directly from the workspace's own vitest so the two resolutions don't
// drift across pnpm-stored copies. The shorthand `import
// "@testing-library/jest-dom/vitest"` re-imports `vitest` through
// jest-dom's own resolution path, which (after a recent lockfile churn
// in this monorepo) lands on a *different* copy of vitest than test
// files do — extensions go nowhere and you get
// `Invalid Chai property: toBeInTheDocument` everywhere. Doing the
// extend manually pins both sides to the same expect.
import { expect, afterEach } from "vitest"
import * as matchers from "@testing-library/jest-dom/matchers"
import { cleanup } from "@testing-library/react"
// Eagerly warm the lazily-loaded file-tree module graph (react-arborist +
// dnd-core + react-dnd-html5-backend) into the module cache before any test
// runs. The filesystem plugin's `FilesystemTreePreloadBinding` — mounted by
// every `WorkspaceProvider` render — fires a fire-and-forget
// `import("./FileTree")` from a mount effect. That dynamic import cannot be
// cancelled on unmount, so under CI timing it can resolve *after* Vitest tears
// the environment down, and its transitive `dnd-core` fetch then throws
// `EnvironmentTeardownError: Cannot load dnd-core ... after the environment was
// torn down` — false-failing unrelated PRs. Vitest only throws on a real module
// *fetch*; a module already evaluated in the cache resolves synchronously with
// no server round-trip. Warming the graph here means the preload's dynamic
// import always hits the cache and never races teardown. Keep this import bare
// (no side effects at module top; the HTML5 backend is only built at render).
import "@/plugins/filesystemPlugin/front/file-tree/FileTree"

expect.extend(matchers)

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom doesn't implement layout — ProseMirror calls getClientRects on
// Range/Element instances during scrollIntoView. Stub them so tiptap
// transactions don't throw.
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
