export const APP_RUNNER_PLUGIN_ID = "app-runner"
export const APP_RUNNER_PANEL_ID = "app-runner.panel"
export const APP_RUNNER_PANEL_TITLE = "Apps"
export const APP_RUNNER_SURFACE_KIND = "app-runner"

/** Default directory (relative to the workspace root) an app is published from. */
export const APP_RUNNER_DEFAULT_DIR = "app"

/** Client-side publish limits, mirrored from the app runner service's own 413 semantics. */
export const APP_RUNNER_MAX_FILES = 200
export const APP_RUNNER_MAX_FILE_BYTES = 2 * 1024 * 1024
export const APP_RUNNER_MAX_TOTAL_BYTES = 10 * 1024 * 1024

export const APP_RUNNER_DEFAULT_URL = "http://127.0.0.1:9877"

/**
 * Header names the app runner's forward-auth contract expects (see
 * APP-RUNNER-SPEC.md "Identity and access"): a signed/shared-secret identity
 * header pair plus a dev-mode shared secret standing in for Caddy
 * forward-auth. Names are this plugin's own choice — the runner's exact
 * expected header casing/name is not yet finalized upstream.
 */
export const APP_RUNNER_USER_HEADER = "X-Boring-User"
export const APP_RUNNER_WORKSPACE_HEADER = "X-Boring-Workspace"
export const APP_RUNNER_AUTH_SECRET_HEADER = "X-Boring-Auth-Secret"

/** Workspace-relative path of the optional tool manifest an app may ship. */
export const APP_RUNNER_TOOLS_MANIFEST_FILENAME = "tools.json"

