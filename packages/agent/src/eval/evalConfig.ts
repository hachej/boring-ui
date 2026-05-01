/**
 * Default model for the eval framework.
 *
 * Pinned deliberately so model deprecation is a visible PR (changelog
 * entry + intentional bump), not a transparent update. Per-suite YAML
 * fixtures override this at the suite level so consumers upgrade at
 * their own pace.
 */
export const DEFAULT_EVAL_MODEL = { provider: "openrouter", id: "qwen/qwen3.6-plus" } as const

/** Default per-call timeout in ms. */
export const DEFAULT_TIMEOUT_MS = 30_000

/** Default suite-level timeout in ms (5 minutes). */
export const DEFAULT_SUITE_TIMEOUT_MS = 5 * 60_000

/** Default concurrency for runEvalSuite. */
export const DEFAULT_CONCURRENCY = 4
