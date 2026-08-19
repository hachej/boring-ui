# DX study evidence log

- Study clock started: 2026-08-11 UTC (exact per-system clocks recorded immediately before each attempt).
- Step rule: one discrete developer action/decision or command invocation; automatic sub-operations do not add steps.
- Written-line rule: nonblank lines in files the developer creates or changes for the requested task; generated untouched files reported separately and excluded from "must write."
- First feedback: first visible success signal after beginning that system's path. First reply: first successful model response from the locally running agent, before HTTP exposure if the documented sequence does that first.
- Errors: preserved verbatim from terminal output, with attempted command and UTC timestamps.

## Flue

- 2026-08-11T21:19:37.837Z, pre-scaffold workspace setup attempt (operator/tool workdir mistake), `mkdir flue` while the execution tool had fallen back outside the intended cwd: `/usr/bin/mkdir: cannot create directory ‘flue’: Read-only file system`. This is not a Flue product error; message is ACTIONABLE because it names the operation and failure.
- Fresh directory successfully created at 2026-08-11T21:19:48.827Z.
- `npx @flue/cli init` started 2026-08-11T21:19:52.606Z. It produced no visible feedback for about 59.6s, then failed with:
  ```text
  npm error code EAI_AGAIN
  npm error syscall getaddrinfo
  npm error errno EAI_AGAIN
  npm error request to https://registry.npmjs.org/@flue%2fcli failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org
  npm error Log files were not written due to an error writing to the directory: /home/ubuntu/.npm/_logs
  npm error You can rerun the command with `--loglevel=verbose` to see the logs in your terminal
  ```
  Environment/npm resolution error, not Flue validation. Grade: ACTIONABLE for the DNS cause, although the proposed verbose rerun does not fix it. Cached tarball was found immediately afterward.
- 2026-08-11T21:21:27.587Z, `npx --offline @flue/cli init` failed in 0.827s: `npm error code ENOTCACHED` and `npm error request to https://registry.npmjs.org/@flue%2fcli failed: cache mode is 'only-if-cached' but no cached response is available.` Grade: ACTIONABLE; it identifies cache resolution, but does not suggest using an existing installed binary.
- 2026-08-11T21:21:32.395Z, `npx --offline @flue/cli@2.0.3 init` failed in 0.709s with the same ENOTCACHED message. Grade: ACTIONABLE. Recovery path: invoke the already installed exact CLI 2.0.3 binary from `/home/ubuntu/projects/spike-flue-celld/node_modules/.bin/flue`, while retaining the fresh target directory.
- Exact installed Flue CLI 2.0.3 init started 2026-08-11T21:21:51.779Z. First visible prompt arrived during the poll ending about 6.0s later (bounded observation, not sub-second exact). Accepting default `Run locally` completed immediately. It generated 8 files and printed three numbered next steps.
- Generated `npm install` started 2026-08-11T21:22:14.975Z. It emitted no output for 200+ seconds and was manually interrupted; verbatim terminal result: `^C`. Grade: VAGUE—the command supplied no progress or diagnosis at all. This is npm/environment behavior, not a Flue-owned message.
- Recovery copied the exact Flue 2.0.3 dependency tree from the user-provided working reference project into the fresh target (2026-08-11T21:26:56.127Z–21:27:08.112Z). This is not a normal onboarding step and is reported separately.
- First `npm run check:types` began 2026-08-11T21:27:37.183Z and passed in 1.3s with no changes.
- First live-agent attempt began 2026-08-11T21:27:48.041Z. The provided Vault lookup failed before Flue started: `Get "http://127.0.0.1:8200/v1/sys/internal/ui/mounts/secret/agent/gemini": dial tcp 127.0.0.1:8200: socket: operation not permitted`. Environment sandbox error; ACTIONABLE (exact endpoint and socket cause) but not fixable within the no-network execution profile.
- Flue still booted and failed at 2026-08-11T21:27:50.052Z. Key excerpt verbatim: `Error: Agent failed: direct(sub_01KZSBJYT8XTC10X8WQ6TMQ5N9) failed: Provider is not configured: google`. Full stack was emitted and the structured error included `type: 'operation_failed'`, operation id, and reason. Grade: ACTIONABLE for identifying provider configuration, though it did not name the expected environment variable. No agent reply occurred; first reply remains NOT-RUN/blocked by credential retrieval, while the framework boot path itself was run.
- Flue HTTP dev server started 2026-08-11T21:28:37.372Z. It printed its npm script and `.env` load, then failed: `Error: listen EPERM: operation not permitted 127.0.0.1:5173` with `code: 'EPERM'`, `syscall: 'listen'`, address, and port. Grade: ACTIONABLE as an environment binding prohibition. HTTP reachability is NOT-RUN because no process may bind a socket in this execution profile.

## eve 0.31.3

- Fresh directory and offline pack attempt began 2026-08-11T21:28:48.685Z. `npm pack --offline eve@0.31.3` failed in 1.3s: `npm error code ENOTCACHED` and `npm error request to https://registry.npmjs.org/eve failed: cache mode is 'only-if-cached' but no cached response is available.` Grade: ACTIONABLE. npm's cache index nevertheless contained the exact 7,720,929-byte tarball.
- Recovered the exact cached tarball by its npm sha512 content address, verified digest `fda7bc91fb152c6a32ebc054fbbb8d1245de110cce1d66978b443e163e680363a7e4f39c5340c647d02766539a0d0a052e812d331467475bab4f0e07d14d8eed`, and extracted it 2026-08-11T21:29:45.783Z–21:29:46.540Z.
- CLI attempt at 2026-08-11T21:30:35.580Z failed immediately and exactly as expected: `eve requires Node.js >=24. You are running v22.22.1. Please install a compatible Node.js version and try again.` Grade: ACTIONABLE; it states requirement, actual version, and remedy.
- All eve init/dev/build/model/HTTP timings are NOT-RUN by instruction because the installed Node is below the package's declared `>=24` engine. `eve/reconstruction/` is an on-paper reconstruction from the shipped templates and docs, not executed output.

## boring-ui 0.1.87 local packages

- Fresh directory created 2026-08-11T21:31:56.882Z–21:31:57.011Z.
- Skill-mandated `status --json` began 2026-08-11T21:32:02.516Z and completed in 0.5s; first visible success feedback was its JSON confirming `workspaceLocalPluginRoots: true` and `reloadSupported: true`.
- Scaffold began 2026-08-11T21:32:08.433Z and finished at 21:32:08.716Z (0.283s), generating package, front, agent, and `.gitignore` files plus seven next steps.
- `verify` began 2026-08-11T21:32:38.046Z and passed at 21:32:38.350Z (0.304s): `OK — 1 plugin(s) have valid manifests + present files.` It explicitly warned that it does not execute plugin code.
- Real CLI server start began 2026-08-11T21:32:43.871Z. It printed workspace/mode/port/host and `starting http://localhost:5200 …`, then emitted:
  - `` `optimizeDeps.rollupOptions` / `ssr.optimizeDeps.rollupOptions` is deprecated. Use `optimizeDeps.rolldownOptions` instead. Note that this option may be set by a plugin. Set VITE_DEPRECATION_TRACE=1 to see where it is called.`` Grade: ACTIONABLE deprecation warning, but it exposes framework-internal config to the new user.
  - `Warning: Invalid input options (1 issue found)` / `- For the "jsx". Invalid key: Expected never but received "jsx".` Grade: VAGUE; no owner, file, or fix is named.
  - `[BORING_WORKSPACE_BRIDGE_INSECURE_AUTH]` warning explaining the local-only policy and the required `workspaceBridge.browserAuthPolicy` before exposure. Grade: ACTIONABLE, though expected localhost behavior reads as alarming during onboarding.
  - `listen EPERM: operation not permitted 127.0.0.1:5200`. Grade: ACTIONABLE environment error. Socket-based HTTP reachability is NOT-RUN.
- In-process Fastify injection (same HTTP handlers, no forbidden socket) ran 2026-08-11T21:33:29.326Z–21:33:33.942Z (4.616s). `/api/v1/workspace/meta`, catalog, skills, and plugins all returned 200; `codebase-qa` appeared in skills and plugins. Reload returned 200 with: `No live agent session to reload yet — changes apply to the next session.` Grade: ACTIONABLE diagnostic, not an error.
- First session creation attempt at 2026-08-11T21:34:42.717Z failed with `{"error":{"code":"INTERNAL_ERROR","message":"ENOENT: no such file or directory, mkdir '/home/ubuntu/.pi/agent/sessions/--home-ubuntu-projects-spike-dx-boring--'"}}`. Grade: VAGUE; the stable code says internal error and gives no `BORING_AGENT_SESSION_ROOT` remedy. This is caused by the workspace-only filesystem policy, not a normal machine.
- The following prompt/state requests returned `{"error":{"code":"SESSION_NOT_FOUND","message":"session not found"}}`. Grade: VAGUE in context because it does not say session creation failed; downstream consequence, not root cause.
- Recovery set `BORING_AGENT_SESSION_ROOT` to a writable workspace directory. Session creation succeeded (201), but the study script mistakenly read `sessionId` instead of the returned `id`, causing another `SESSION_NOT_FOUND`; operator error prompted by an undocumented response shape in the required onboarding docs.
- Corrected live prompt attempt ran 2026-08-11T21:35:25.424Z–21:35:35.965Z. Session creation returned 201 and prompt admission returned 202. During resource load, an unrelated global Ollama extension printed `Failed to register Ollama provider: TypeError: fetch failed` caused by `getaddrinfo EAI_AGAIN ollama.com`; grade MISLEADING because it is unrelated to the selected OpenRouter/Gemini model and the prompt remained admitted.
- The terminal assistant state was `error`, with exact message: `Failed to resolve API key for provider "openrouter" from shell command: vault kv get -field=api_key secret/agent/openrouter`. Grade: ACTIONABLE; it names provider and failing recovery command. No agent reply occurred because the environment forbids the Vault socket. Time to first agent reply is therefore NOT-RUN/blocked, not fabricated.
