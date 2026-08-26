import { setTimeout as sleep } from "node:timers/promises"
import { createUiReviewTempDir, installUiReviewTempCleanupHandlers, uiReviewTempRoot } from "../core/tempRoot"

// Child process used by tempRoot.test.ts.
//   `armed`      — a CLI entrypoint: opts in to signal cleanup, so the run root survives nothing but the process.
//   `armed+hook` — same, but registers a beforeCleanup hook that must run before removal.
//   `bare`       — a Playwright/vitest worker: only imports and uses the helper, which must arm no signal handler.
const mode = process.argv[2] ?? ""
if (mode.startsWith("armed")) {
  installUiReviewTempCleanupHandlers(mode === "armed+hook" ? { beforeCleanup: () => console.log("UI_REVIEW_TEMP_BEFORE_CLEANUP") } : undefined)
}

const root = await uiReviewTempRoot()
await createUiReviewTempDir("child.")
const listeners = { SIGINT: process.listenerCount("SIGINT"), SIGTERM: process.listenerCount("SIGTERM"), SIGHUP: process.listenerCount("SIGHUP") }
console.log(`UI_REVIEW_TEMP_LISTENERS:${JSON.stringify(listeners)}`)
console.log(`UI_REVIEW_TEMP_ROOT:${root}`)
await sleep(30_000)
