# Remote bwrap Worker Launch Plan — Thermo Review Notes

Requested reviewer: Opus 4.8. Exact model id attempts failed in this environment (`anthropic/claude-opus-4.8` unavailable / insufficient credits via subagent; unavailable via Claude CLI). Review was run with Claude Code `--model opus` as the available Opus alias.

## Review summary

Blocking points identified:

1. Route prefix list must match actual registered routes. Fix `/api/v1/fs/events`; include `/api/v1/workspace-settings`, `/api/v1/dirs`, and `/api/v1/stat`; do not proxy plugin routes for launch.
2. Do not casually run 2 workers. In-memory UI bridge/chat state require one worker or sticky-by-workspace routing.
3. SSE proxying needs an explicit streaming-capable proxy implementation and timeout behavior.
4. Public app must strip browser-supplied internal headers and reinject trusted workspace context after authz.
5. Single Fly Volume needs snapshot/backup before launch.
6. Rollback by unsetting remote proxy only works if public app keeps bwrap and compatible `/data` mount; worker-created data is not automatically portable.
7. Worker should expose no public surface if feasible and trust headers only behind internal token.
8. Use tiny explicit worker server; do not pull plugin-authoring/dynamic plugin runtime onto sandbox worker for launch.
9. Concurrency cap should wrap executions, not SSE streams.
10. Add cheap `ulimit`/`prlimit` wrapper if time permits because bwrap alone does not enforce CPU/RAM.

## Integrated revisions

These findings were integrated into `REMOTE_BWRAP_WORKER_LAUNCH_PLAN.md`.

## Second review pass

Ran a second Claude Code Opus review after revisions. Remaining P0/P1 launch blockers:

1. Concurrency limiter is still a requirement, not an implemented/precise task. It must wrap prompt/command execution only, not SSE streams.
2. SSE streaming through the public-to-worker proxy remains the highest-risk unproven integration point. Must validate `/api/v1/fs/events`, `/api/v1/agent/pi-chat/*/events`, and `/api/v1/ui/commands/next` before launch.
3. bwrap still lacks per-command CPU/RAM limits. `ulimit`/`prlimit` should be upgraded from “if time permits” to pre-launch P1 if public users can run arbitrary commands.
4. Single worker is a hard accepted capacity/availability ceiling until sticky routing exists.
5. Worker restart behavior must be tested; in-memory bridge/session state may be lost.
6. Rollback after public writes needs an explicit data-copy/backout decision because worker `/data` writes are not automatically on public app volume.
7. Worker private-only exposure must be confirmed, not “if feasible”. Internal token must be set on both apps.
8. Fly volume snapshot/backup must be confirmed enabled before launch.

## Third review pass — Opus + Codex after simplicity edits

### Opus remaining findings

1. Worker env must include the LLM/model provider credentials needed by the agent. The worker should not inherit DB/auth/mail secrets, but it does need model credentials or the agent cannot run.
2. Audit proxied routes that may require DB/auth context not present on the worker, especially `/api/v1/files/records`, `/api/v1/workspace-settings`, and `/api/v1/git`.
3. `x-boring-user-id: if easily available` is unsafe ambiguity. Either make it required and always forwarded, or confirm worker code does not use it.
4. Config-only rollback after worker writes is not a real data rollback. Mark it as service-shape rollback only unless data is copied back.
5. The manual allowlist can drift. Keep it short and verify route-by-route before launch.
6. Define the exact semaphore hook points rather than leaving “prompt/command execution only” abstract.
7. Confirm `agent-worker.ts` is compiled into the production image.
8. Default public posture should be gated/beta if `ulimit`/`prlimit` is not ready.
9. Worker restart test is a launch gate because it combines bridge loss, chat continuity risk, and temporary workspace unavailability.
10. Pi session files may default under process home unless `sessionNamespace`/`sessionDir` is supplied; worker restart/redeploy can lose chat continuity even when `/data/workspaces` survives.

### Codex remaining findings

1. Prove every proxied route is workspace-scoped and safe under only trusted worker headers.
2. Define workspace provisioning/migration: when worker dirs are created, seeded, permissioned, and how existing public-app workspaces are handled.
3. Worker env must be allowlisted, not copied from public app; include only internal token, mode/root config, required model keys, and no DB/auth/mail secrets.
4. Worker private-only exposure must be a hard gate with both config review and an external negative reachability check.
5. Define exact execution semaphore hook points; ensure it catches chat-triggered long-running bash and does not count SSE.
6. Spike SSE proxy first because the architecture fails if streaming semantics do not work.
7. Drop rollback-to-local as an operational promise after public writes; rollback means disable execution/read-only/copy data first.
8. Disable plugin/runtime routes explicitly with a launch flag or startup assertion, not merely by omitting proxy routes.

## Fly bwrap smoke result

Ran a live smoke test on the existing `boring-full-app` Fly Machine in `cdg` using the installed `bubblewrap` package. Result: `bwrap --unshare-all --share-net --tmpfs / --proc /proc --dev /dev ... --bind /tmp/bwrap-smoke /workspace ... bash -lc 'pwd; id; cat hello.txt; echo ok'` succeeded and printed `/workspace`, the test file content, and `ok`.

Conclusion: bwrap works inside the current Fly Machine environment. Still test again on the final `boring-sandbox-worker` app/image after it is created.

## Fourth review pass — no-leak update, host-owned model calls

### Claude Code / Opus findings

1. Worker token guard must fail closed. Worker must refuse to start if `BORING_WORKER_INTERNAL_TOKEN` is empty/missing, and request guard must reject empty/missing header tokens explicitly.
2. Previous review note saying worker needs LLM/model keys is now wrong under architecture B. Delete/ignore it: agent/model stays on host, worker receives zero model keys.
3. Route-by-route audit is still required for public routes backed by the remote adapter, especially DB/context-sensitive routes like file records, workspace settings, and git helpers.
4. Existing workspace cutover is unspecified. If current files live on public `/data`, copy/seed them to worker `/data` before launch or users may see empty workspaces.
5. SSE/file-watch streaming should be spiked first. If it slips, the architecture slips.
6. `RemoteWorkspace.watch()` needs reconnect + resync/refetch semantics; silent dropped file events create stale UI perception.
7. bwrap read-only mounts must be audited for baked-in secrets under mounted dirs like `/etc`.
8. Verify current public app does not trust browser-supplied `x-boring-workspace-id` anywhere before worker calls.

### Codex / OpenAI findings

1. Worker API is still broad for one-day launch. Consider cutting to minimum: read/write/list + exec + maybe events; defer search/git/watch if not required.
2. Public-app logs/telemetry need the same no-content/no-token rules as worker logs because host sees prompts, file contents, stdout/stderr, and provider responses.
3. Launch copy must be explicit: storage/execution are EU-hosted, but model processing follows provider terms if prompts include workspace content.
4. Keep remote-worker branching behind one clean runtime-bundle boundary. Route registration should not know or grow conditionals.
5. Streaming through two servers is high risk. Buffered streams, dropped disconnects, and hanging fetches are launch blockers.
6. Worker must validate method allowlist, path allowlist, workspace id header/path match, body size limits, and request timeouts; internal token alone is not enough.
7. Semaphore + timeout do not prevent fork bombs, disk fill, inode exhaustion, or huge tmp writes. Add disk/tmp guardrails or gate launch behind beta/invite.
8. Rollback copy-back needs an explicit operational command/procedure, downtime/read-only window, conflict policy, and verification.

## Fifth review pass — cleaned plan, Claude + GPT-5.5/Codex

### Claude Code / Opus findings

1. `/internal/.../git/file-url` is underspecified and may leak repo URLs/tokens. Either define it or cut it from launch scope.
2. Header stripping needs a named enforcement point: one choke function that builds worker requests and never forwards inbound browser headers.
3. bwrap env allowlist means shell commands cannot use host/user credentials unless explicitly provisioned. State launch behavior for commands needing credentials.
4. Worker file-event streaming is still the riskiest unproven path; specify transport/heartbeat/flush behavior or spike first.
5. Worker restart must clean up/reap orphaned bwrap children; otherwise process-local exec caps reset while old commands survive.
6. Cutover copy preserving symlinks conflicts with symlink-escape defenses. Validate symlinks during copy or reject escaping legacy symlinks.
7. Use constant-time token comparison (`timingSafeEqual`) for internal token checks.
8. Define public app behavior when `BORING_WORKER_BASE_URL` is set but worker is unavailable at boot: fail closed with clear degraded runtime error, not local fallback.

### GPT-5.5 / Codex findings

1. bwrap network/proc isolation needs explicit posture. Sandboxed commands must not reach worker internals, metadata services, or secrets via localhost/private networking/proc.
2. Remote mode must fail closed: if worker config/health/token is bad, public app must not silently fall back to local bwrap/direct execution.
3. Filesystem-touch inventory needs a route/tool matrix so every path touching `/data/workspaces` is worker-backed in remote mode.
4. Worker API is still bigger than “tiny”; cut git/live watch/search to polling/minimum if not launch-critical.
5. Path validation must use one canonical resolver with URL decoding, null-byte rejection, relative-path enforcement, realpath symlink checks, and shared tests.
6. Resource exhaustion still needs free-space guard/write rejection/alerts plus exec semaphore and surgical PID/file/process limits where possible.
7. Maintenance/read-only mode for cutover/rollback must actually block editor writes, agent writes, and exec while copying, and verify no active streams/execs.
8. Dynamic plugin execution and no-content/no-token logging need proof via startup assertions/smoke tests/log sampling, not only policy text.
