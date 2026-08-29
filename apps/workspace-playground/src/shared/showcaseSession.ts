/**
 * Shared between the playground front (`front/App.tsx`) and the scripted
 * dev server (`server/testing/scriptedPiHarness.ts`).
 *
 * A stable, non-displayed prefix applied to the *backend* session title for
 * every session the `?showcase=1` route creates. The showcase route always
 * supplies its own client-side display title via the controlled `sessions`
 * prop it hands `WorkspaceAgentFront` — the workspace shell never reads a
 * showcase session's server-stored title back out — so this tag can ride
 * along in that field without ever reaching a user.
 *
 * It exists so the scripted harness's boot-time sweep (see
 * `sweepStaleShowcaseSessions` in scriptedPiHarness.ts) can scope itself to
 * showcase-originated sessions and never touch an unrelated empty session a
 * developer is mid-way through creating in the ordinary (non-showcase)
 * playground route.
 */
export const SHOWCASE_SESSION_TITLE_TAG = "[playground-showcase] "
