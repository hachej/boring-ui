import {
  defaultUrlPanePolicy,
  parseUrlPaneOrigins,
  type UrlPanePolicy,
} from "../../shared/urlPane"

export const URL_PANE_ORIGINS_ENV = "BORING_URL_PANE_ALLOWED_ORIGINS"

/**
 * Env is the config seam for the URL pane allowlist, matching how the hub is
 * already deployed (one env block per host). Unset means "loopback only", which
 * is the ratified default; an explicit empty value means "closed", which is the
 * only way to turn the surface off without unregistering the plugin.
 */
export function resolveUrlPanePolicyFromEnv(env: NodeJS.ProcessEnv = process.env): UrlPanePolicy {
  const raw = env[URL_PANE_ORIGINS_ENV]
  if (raw === undefined) return defaultUrlPanePolicy()
  return { origins: parseUrlPaneOrigins(raw) }
}
