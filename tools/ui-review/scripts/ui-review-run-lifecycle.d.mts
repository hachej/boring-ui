import type { SpawnOptions } from "node:child_process"

export const UI_REVIEW_RUN_ROOT_PREFIX: string
export const UI_REVIEW_RUN_MARKER: string
export const UI_REVIEW_RUN_MARKER_KIND: string
export const UI_REVIEW_RUN_MARKER_VERSION: number
export const UI_REVIEW_RUN_ROOT_ENV: string
export const UI_REVIEW_TERMINATION_GRACE_MS: number

export type UiReviewRunLifecycle = {
  root: string
  env: Record<string, string>
  allocateDirectory(label: string): Promise<string>
  run(command: string, args: string[], options?: SpawnOptions): Promise<number>
  cleanup(): Promise<void>
  shutdown(): Promise<void>
  installSignalHandlers(): void
  removeSignalHandlers(): void
}

export function createUiReviewRunLifecycle(options?: {
  temporaryDirectory?: string
  terminationGraceMs?: number
}): Promise<UiReviewRunLifecycle>
export function allocateUiReviewRunDirectory(label: string, env?: NodeJS.ProcessEnv): Promise<string>
export function deleteOwnedUiReviewRunRoot(candidateRoot: string, expectedParent: string): Promise<void>
