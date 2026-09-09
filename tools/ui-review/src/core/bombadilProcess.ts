import { mkdir, rm } from "node:fs/promises"
import { resolve } from "node:path"

export type BombadilProcessResult = { code: number | null; stderr: string }

export async function runWithBombadilStartupRetry(input: {
  runAttempt: () => Promise<BombadilProcessResult>
  resetOutput: () => Promise<void>
  waitBeforeRetry: () => Promise<void>
  onRetry?: () => void
}): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await input.runAttempt()
    if (result.code === 0 || result.code === 2) return
    if (attempt === 0 && isRetryableBombadilStartupFailure(result.stderr)) {
      await input.resetOutput()
      await input.waitBeforeRetry()
      input.onRetry?.()
      continue
    }
    throw new Error(`UI_REVIEW_BOMBADIL_FAILED:${result.code ?? "unknown"}`)
  }
}

export function isRetryableBombadilStartupFailure(stderr: string): boolean {
  return stderr.includes("Timeout while resolving websocket URL from browser process")
    || stderr.includes("Failed to create a ProcessSingleton for your profile directory")
}

export async function resetBombadilOutputDirectory(cwd: string, outputPath: string): Promise<void> {
  const target = resolve(cwd, outputPath)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
}
