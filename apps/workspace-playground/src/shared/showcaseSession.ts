/**
 * Shared between the playground front (`front/App.tsx`) and the dev server
 * (`server/dev.ts`, `server/testing/scriptedPiHarness.ts`).
 *
 * Every session the `?showcase=1` route creates goes through this dev-only
 * wrapper route instead of the ordinary `/api/v1/agents/:agentTypeId/sessions`
 * endpoint. The wrapper forwards the create request unchanged and then
 * records the resulting session id in a provenance registry the scripted
 * harness's boot-time sweep reads (see `markPlaygroundShowcaseSession` and
 * `sweepStaleShowcaseSessions` in scriptedPiHarness.ts).
 *
 * This route — not title text — is what marks a session as
 * showcase-originated. An earlier version used a fixed title prefix, which
 * an ordinary session could collide with (the create/rename HTTP schemas
 * accept any title). Routing through a dedicated dev-only endpoint that the
 * normal (non-showcase) session UI never calls makes that collision
 * impossible: nothing a user types into a title can route a request here.
 */
export const PLAYGROUND_SHOWCASE_SESSION_ROUTE = "/api/v1/playground/showcase-sessions"
