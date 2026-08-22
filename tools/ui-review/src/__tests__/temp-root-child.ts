import { setTimeout as sleep } from "node:timers/promises"
import { createUiReviewTempDir, installUiReviewTempCleanupHandlers, uiReviewTempRoot } from "../core/tempRoot"

// Child process used by tempRoot.test.ts.
//   `armed` — a CLI entrypoint: opts in to signal cleanup, so the run root survives nothing but the process.
//   `bare`  — a Playwright/vitest worker: only imports and uses the helper, which must arm no signal handler.
if (process.argv[2] === "armed") installUiReviewTempCleanupHandlers()

const root = await uiReviewTempRoot()
await createUiReviewTempDir("child.")
const listeners = { SIGINT: process.listenerCount("SIGINT"), SIGTERM: process.listenerCount("SIGTERM"), SIGHUP: process.listenerCount("SIGHUP") }
console.log(`UI_REVIEW_TEMP_LISTENERS:${JSON.stringify(listeners)}`)
console.log(`UI_REVIEW_TEMP_ROOT:${root}`)
await sleep(30_000)
