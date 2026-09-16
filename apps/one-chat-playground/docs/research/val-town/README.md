# Val Town — how it runs user-made apps (2026-09-15)

## Runtime
- Four runtimes over time: Node `vm` (escapes), `vm2` (escapes, deprecated upstream), Deno worker threads in one server (leaks, escapes), then the current one: a Node orchestrator spawning **one Deno process per val**, pre-warmed pool. Each rewrite was driven by a real security failure, not cost. (blog: "The first four Val Town runtimes")
- HTTP vals historically paid a 100 ms+ cold start per request; the "HTTP Val Runtime" preview keeps the process warm between requests (~10 ms), killing it **10 s after the last request**.
- URL per val: `https://<user>-<val>.web.val.run`; custom domains are paid.

## Data
- `std/sqlite`: an isolated SQLite per val by default (`std/sqlite/main`), an account-wide shared database as an opt-in (`std/sqlite/global`). Backed by **Turso / libSQL as a service**, not a file in the process. API: `execute(sql|{sql,args})`, `batch([...])`. No migration framework; apps do `CREATE TABLE IF NOT EXISTS`.
- `std/blob`: R2-backed key-value, account-scoped by default.
- Quota: 10 MB free / 1 GB Pro, shared by SQLite and blob.
- **Data is only reachable through the val's own server code.** There is no client-only path to a shared data API.

## Isolation
- OS process per val, Deno permission flags (`--allow-net`, env scoped to the user's own secrets). No gVisor mentioned in their material.

## App shape (Townie)
- A Project folder: `/backend/index.ts` (Hono, serves API routes and the built frontend) + `/frontend/index.html`, `index.tsx`, `components/App.tsx` (React). URL imports via esm.sh, no bundler step; deploy ≈100 ms. Every save is live.

## Versioning
- Every save is a version; projects have git-like branches, forks/remixes and merges. Rollback is instant and **code only**: data is not rolled back.

## Economics / ops
- Public numbers are thin: ~100k runs/day free, ~1M Pro. Post-mortems published (blob storage outage). The runtime retrospective is the main "lessons" document.

## What we took from it
- **Keep a server runtime per app** (our TanStack Start + SQLite template). Their history is the argument against a shared runtime for untrusted code.
- **Data never rolls back with code.** Same rule as ours.
- **Per-app database with an opt-in per-user shared database.** Add the shared handle when a tester first asks for two apps that talk.
- **Warm process, idle kill.** The shape to aim for once per-app processes must be cheap; our two Vite dev servers per app are the heavy version.
- **Hosted libSQL when sandboxes become disposable.** A driver swap behind Drizzle, not a redesign.

## Sources
- https://blog.val.town/blog/first-four-val-town-runtimes/
- https://blog.val.town/http-preview
- https://docs.val.town/std/sqlite/usage/
- https://docs.val.town/std/blob/
- https://blog.val.town/blog/codegen/
- https://blog.val.town/projects
- https://docs.val.town/reference/version-control/
- https://docs.val.town/vals/remixes/
- https://www.val.town/x/std/reactHonoStarter
