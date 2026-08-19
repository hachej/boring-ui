# Hands-on developer-experience study: local codebase agent + one tool + one skill + HTTP

## Result

No system produced a model reply in this runner. That is a measured result, not an omission: the execution profile denied the supplied Vault connection (`socket: operation not permitted`), all outbound model access, and all TCP listeners. Flue and boring-ui were run through model admission and failed on credential resolution; eve was deliberately NOT-RUN because Node is v22.22.1 and eve 0.31.3 requires Node >=24.

The useful like-for-like result is therefore:

- boring-ui reached verified plugin + skill discovery in **41.5 seconds** from creating its directory and reached working HTTP handlers in-process in **1 minute 37.1 seconds**. It did not produce a reply after **3 minutes 39.1 seconds** because Vault was inaccessible.
- Flue reached a valid typechecked implementation in approximately **7 minutes 49.7 seconds**, including a 200+ second silent `npm install` failure and dependency recovery. It did not produce a reply after **8 minutes 1.2 seconds** because Vault was inaccessible.
- eve is **NOT-RUN**. The shipped CLI rejected Node 22 in under 0.5 seconds with an excellent error. Its six-step task path below is reconstructed from the actual 0.31.3 tarball, not timed execution.

Those elapsed values include the failures a developer actually experienced. They should not be presented as framework-only benchmarks. The clean-path action counts and framework timings are reported alongside them.

## Method and fairness rules

- Workspace: `/home/ubuntu/projects/spike-dx`, with `flue/`, `eve/`, and `boring/` subdirectories.
- Wall-clock source: UTC epoch-millisecond stamps printed immediately before and after commands. Where interactive output arrived between polls, the result is reported as an upper bound rather than invented precision.
- A discrete step is one developer action, decision, command, or file creation/edit. Automatic sub-operations do not add steps.
- “Lines written” means nonblank lines the developer must add or replace for this task. Untouched scaffold output is excluded and reported separately.
- “First feedback” is the first visible success signal. An error is still recorded, but it is not called a sign that the framework works.
- “Time to first reply” means a completed model answer, not server boot, prompt admission, an empty assistant message, or a mocked response.
- The undefined-term audit is scoped to specialized product/architecture vocabulary a developer must understand to follow the required path. Generic TypeScript/HTTP words such as “file,” “function,” “request,” and “server” are excluded.
- Network/package/Vault/socket failures are retained because they shape the real onboarding, but are explicitly separated from framework-owned validation.

## Side-by-side comparison of items 1–6

| Measure | Flue 2.0.3 | eve 0.31.3 | boring-ui 0.1.87 |
|---|---|---|---|
| 1. Time to first agent reply | **NOT-RUN / blocked.** Live run attempted after 8m01.2s; provider configuration failed before a model reply. Clean task path: 13 steps. Observed study path: 18 steps including three install retries and recovery. | **NOT-RUN by instruction.** Node guard stopped immediately. On-paper task path: 6 steps; inspection/reconstruction: 6 steps. | **NOT-RUN / blocked.** Prompt accepted after 3m38.2s; terminal error at 3m39.1s when the auth-store Vault command could not run. Clean task path: 8 steps. Observed study path: 14 steps including environment and study-probe recovery. |
| 2. Developer-created/edited files and lines | **7 files, 46 nonblank lines**: `package.json`, generated agent, tool, skill, app router, Vite config, `.env`. Six additional scaffold files remain untouched. | **5 files, 36 nonblank lines on paper**: agent config, instructions, tool, skill, credential env line. HTTP channel/package/tsconfig are scaffolded. **NOT-RUN.** | **3 files, 25 nonblank lines**: plugin manifest, generated Pi extension, skill. The scaffold also emits an untouched 125-nonblank-line UI panel and `.gitignore`, neither needed for this task. No credential file is normally edited because Pi owns the auth store. |
| 3. Concepts before step 1 | **3**: supported Node version; local/deploy/both target; provider/model/API-key pairing. | **3**: Node 24; npm/scaffold behavior; Gateway/OIDC/direct-provider credential path. | **6**: CLI vs standalone/workspace/full-app host; workspace root; direct vs bwrap mode; runtime vs app/internal plugin trust; Pi resource vs server `extraTools`; Pi auth-store/provider setup. |
| 4. Errors encountered | **8 events**: one operator cwd error, DNS resolution, two cache-resolution errors, silent interrupted install, Vault socket denial, provider-not-configured, listener EPERM. Flue’s structured provider error was actionable; npm silence was worst. | **2 events**: npm cache-resolution failure and Node-version guard. Node guard was the best error in the study. | **5 error families + 3 warning families**: listener EPERM, session-store ENOENT, downstream session-not-found, unrelated Ollama fetch, Vault-backed provider key failure, plus Vite/JSX/local-auth warnings. Stable envelopes helped, but `INTERNAL_ERROR` hid a configurable session-root problem. |
| 5. Zero configuration | Init generated agent, SQLite persistence, config, docs, and local runner. Required decisions/work: provider/model, host sandbox for codebase access, tool + skill mounting, three HTTP packages, router, Vite config. | Filesystem discovery, default sandbox, skill/tool naming, durable runtime, and HTTP session routes are built in. Required decisions: Node upgrade, credential source/model, tool code, skill content. | CLI already supplies codebase tools, workspace, UI, Fastify HTTP app, filesystem, sessions, and hot-reload discovery. Required decisions: plugin tier and provider auth. The agent-only task still receives an unnecessary UI panel/slash command. |
| 6. First feedback | Requested `npx` was silent ~59.6s then errored. After recovery, installed CLI’s prompt appeared within **<=6.0s**; successful scaffold completion followed immediately. From study start, first success was about **2m09s**. | Offline pack error in 1.3s; Node incompatibility feedback in <0.5s. No success feedback because execution was intentionally stopped. | `status --json` succeeded in **0.5s**; scaffold succeeded in **0.283s**; CLI printed `starting http://localhost:5200 …` within **<=3.0s** before the environment denied bind. |

## A. Flue

### What was actually done

The requested fresh `npx @flue/cli init` was attempted first. npm could not resolve the registry. Two offline retries also failed even though npm’s content cache and the supplied working Flue project contained 2.0.3. I then invoked the exact installed 2.0.3 CLI binary from `/home/ubuntu/projects/spike-flue-celld/node_modules/.bin/flue`, still targeting the fresh directory.

The init prompt offered `Run locally`, `Deploy`, or `Both`; I selected `Run locally`. It generated:

```text
flue.config.ts
package.json
tsconfig.json
.gitignore
.env
src/agents/hello.ts
src/db.ts
AGENTS.md
README.md
```

The generated next steps were exactly:

```text
1. npm install
2. add a model provider API key to .env
3. npx flue run src/agents/hello.ts --message "Say hello!"
```

`npm install` then emitted nothing for more than 200 seconds. I interrupted it and copied the exact 2.0.3 dependency tree from the supplied working project. This recovery is not a normal onboarding step.

I used Flue’s bundled docs command to read the tool, skill, getting-started, and Node target pages. The implementation then:

- changed the model to `google/gemini-2.5-flash`;
- mounted `local()` so built-in `read`, `grep`, `glob`, and shell tools can inspect the codebase;
- added and mounted `project_facts` with `defineTool`/`useTool`;
- added and mounted a `codebase-qa` Agent Skill with `useSkill`;
- added Hono/Vite/`@flue/vite`, `src/app.ts`, and `vite.config.ts` for HTTP;
- passed `tsc --noEmit` on the first attempt.

Files are in `/home/ubuntu/projects/spike-dx/flue`. Typechecking took 1.3 seconds. The live CLI loaded the agent, created a durable conversation id, printed the user message, and then failed because the provider key was unavailable. Vite subsequently failed to bind because this runner forbids listeners. Model reply and HTTP reachability are therefore NOT-RUN.

### Step count

Clean developer path for this task: **13 steps**.

1. Create directory.
2. Run init and choose local.
3. Install dependencies.
4. choose/configure model + API key.
5. Give the agent a local codebase sandbox.
6. Create a tool.
7. Create a skill.
8. Mount tool and skill in the agent.
9. Add HTTP dependencies.
10. Create the Hono agent router.
11. Create Vite config.
12. Run the local agent.
13. Start Vite dev server.

Observed study path: **18 steps**, because init resolution required three attempts, install required recovery, and docs had to be searched before the serving command was known.

### Files and lines

Developer-authored or changed for the task:

| File | Nonblank lines written/changed | Why |
|---|---:|---|
| `package.json` | 4 | dev script + Hono, Vite, Flue Vite dependencies |
| `src/agents/hello.ts` | 9 | model, local sandbox, tool + skill imports/mounts, codebase instruction |
| `src/tools/project-facts.ts` | 14 | custom tool |
| `src/skills/codebase-qa/SKILL.md` | 9 | skill |
| `src/app.ts` | 6 | HTTP router |
| `vite.config.ts` | 3 | Flue/Vite plugin |
| `.env` | 1 | provider key; required but NOT WRITTEN because Vault was inaccessible |
| **Total** | **46** | **7 files** |

The generated database/config/docs files are not charged as developer-written lines.

### Concepts and undefined terms

Three concepts are unavoidable before the first task step: supported Node version, target choice, and provider/model/key pairing.

Twelve specialized terms appear in the required pages without a local definition: **Pi, model provider, Hono, Vite, Valibot, JSON Schema, Agent Skills specification, MCP, CORS, prompt cache, Cloudflare Durable Object, Fiber recovery**. Most are linked, which helps, but a human must leave the Flue docs to understand them.

### Every error, verbatim, with grade

1. Study setup error, not Flue:

   ```text
   /usr/bin/mkdir: cannot create directory ‘flue’: Read-only file system
   ```

   **ACTIONABLE**: exact operation and failure. Caused by the execution tool falling back from a nonexistent cwd.

2. Requested `npx` resolution:

   ```text
   npm error code EAI_AGAIN
   npm error syscall getaddrinfo
   npm error errno EAI_AGAIN
   npm error request to https://registry.npmjs.org/@flue%2fcli failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org
   npm error Log files were not written due to an error writing to the directory: /home/ubuntu/.npm/_logs
   npm error You can rerun the command with `--loglevel=verbose` to see the logs in your terminal
   ```

   **ACTIONABLE** about DNS; the suggested verbose rerun diagnoses but does not fix it.

3. Both offline retries:

   ```text
   npm error code ENOTCACHED
   npm error request to https://registry.npmjs.org/@flue%2fcli failed: cache mode is 'only-if-cached' but no cached response is available.
   ```

   **ACTIONABLE**, though it does not suggest using the already installed exact binary. This occurred twice, once versionless and once pinned to 2.0.3.

4. Generated install command after more than 200 seconds:

   ```text
   ^C
   ```

   **VAGUE**. No progress, retry state, dependency name, or network diagnosis appeared. This was the worst feedback gap in the study and is npm-owned.

5. Supplied credential retrieval:

   ```text
   Get "http://127.0.0.1:8200/v1/sys/internal/ui/mounts/secret/agent/gemini": dial tcp 127.0.0.1:8200: socket: operation not permitted
   ```

   **ACTIONABLE** environment error; exact endpoint and syscall reason.

6. Flue live run:

   ```text
   Error: Agent failed: direct(sub_01KZSBJYT8XTC10X8WQ6TMQ5N9) failed: Provider is not configured: google
   ```

   **ACTIONABLE**. The structured error also supplied type, operation id, and reason. It should additionally name the credential variable it checked.

7. HTTP dev server:

   ```text
   Error: listen EPERM: operation not permitted 127.0.0.1:5173
   ```

   **ACTIONABLE** environment error; stack also included code, syscall, address, and port.

### Zero config versus required decisions

Zero config: TypeScript project, agent discovery via `'use agent'`, SQLite persistence, local runner, `.env` loading, project-local agent docs, and durable conversation IDs.

Required before useful codebase Q&A: model/provider, local sandbox, tool shape, skill mount, and provider key. Required before HTTP: install three more packages, learn Hono/Vite, create two files, and define a route. “Then serve” is not `flue serve`; it is `vite dev` after the deployment section is implemented.

### Docs assessment

There is a canonical zero-to-agent path: generated README -> `flue run`. There is also a canonical HTTP continuation in Getting Started. They are separated enough that the exact task is not one continuous checklist.

Dead ends/friction:

- `flue docs search serve` ranked MCP first and Node target second; Getting Started, the page with the needed server recipe, ranked sixth.
- Init’s local scaffold hardcodes Anthropic while `.env` says any Pi provider works. Switching to Gemini requires changing both model id and credential variable, but the printed next steps mention only the key.
- The automatic-installation section deliberately tells the reader to paste a prompt into a coding agent and calls that strongly recommended. This helps an agent because it provides local routing and exact commands. For a human it delays the direct instructions and makes a small TypeScript setup feel agent-dependent.
- The HTTP section is human-readable and concrete once found; its route and curl example are better than ours.

## B. eve

### What was actually done

`npm pack --offline eve@0.31.3` was attempted. npm said the response was not cached even though its index contained the exact tarball. I recovered the tarball from npm’s content-addressed cache, verified the sha512 digest, and extracted the published package.

The package declares:

```json
{"engines":{"node":">=24"},"bin":{"eve":"./bin/eve.js"}}
```

Running its binary under Node 22 produced the intended guard and stopped. Per the task instruction, init, install, dev server, model call, tool call, and HTTP were **NOT-RUN**.

I read the shipped templates and required docs and reconstructed the task under `/home/ubuntu/projects/spike-dx/eve/reconstruction`. Those files are explicitly on paper; they were not typechecked or executed.

### On-paper path and step count

The comparable developer path is **6 steps**:

1. `npx eve@latest init eve-codebase-agent` (scaffold, install, Git init, and dev startup are automatic).
2. Configure the Gemini credential/provider route.
3. Edit `agent/agent.ts` and `agent/instructions.md` for codebase Q&A.
4. Create `agent/tools/project_facts.ts`.
5. Create `agent/skills/codebase-qa.md`.
6. Run `npm run dev`; the HTTP API is already present under `/eve/v1/session*`.

All six are **NOT-RUN**. The study itself performed six inspection actions: make directory, pack attempt, cache recovery/extract, docs/template inspection, CLI guard attempt, and on-paper reconstruction.

### Files and lines

The shipped scaffold itself creates package/tsconfig/ignore/agent/channel/docs files. For this task, a developer would create or edit:

| File | Nonblank lines | Status |
|---|---:|---|
| `agent/agent.ts` | 13 | reconstructed BYOK Google/Gemini config; NOT-RUN |
| `agent/instructions.md` | 3 | NOT-RUN |
| `agent/tools/project_facts.ts` | 14 | NOT-RUN |
| `agent/skills/codebase-qa.md` | 5 | NOT-RUN |
| `.env.local` | 1 | required credential; NOT WRITTEN/NOT-RUN |
| **Total** | **36** | **5 files, all NOT-RUN** |

The default HTTP channel requires no new file. The scaffold still generates `agent/channels/eve.ts` to make local/OIDC/placeholder auth policy explicit.

### Concepts and undefined terms

Three prerequisite concepts: Node 24, npm/scaffold behavior, and one of the Gateway/OIDC/direct-provider credential paths.

Nineteen specialized terms appear without a definition in the required pages: **Vercel AI Gateway, Vercel OIDC, AI SDK, Nitro, Workflows, Workflow SDK, workflow world, MCP, OpenAPI, Standard Schema, Zod, HITL, ACP, shadcn registry, NDJSON, OTel, BYOK, CORS, REPL**. Some receive a one-line role later; none is defined at first use in the core path.

### Every error, verbatim, with grade

1. npm pack:

   ```text
   npm error code ENOTCACHED
   npm error request to https://registry.npmjs.org/eve failed: cache mode is 'only-if-cached' but no cached response is available.
   ```

   **ACTIONABLE** cache/network diagnosis, although npm did contain the tarball bytes.

2. CLI version guard:

   ```text
   eve requires Node.js >=24. You are running v22.22.1. Please install a compatible Node.js version and try again.
   ```

   **ACTIONABLE**. This is the best onboarding error observed: requirement, actual state, and exact corrective action in one sentence.

### Zero config versus required decisions

Zero config on paper: filesystem discovery, path-derived tool/skill names, default sandbox, durable runtime, terminal UI, health/info/session/stream/control HTTP routes, and localhost auth.

Required decisions: Node upgrade, model credential route, provider/model, instructions, tool behavior, skill procedure. HTTP itself demands no router or serving code, a clear advantage over Flue and parity with boring-ui’s CLI.

### Docs assessment

The human path is clear at the top level: Getting Started -> Installation -> Project Structure -> first-agent tutorial. Installation is short and the Node requirement is impossible to miss.

Dead ends, stale edges, and contradictions:

- The packaged docs index points to `../apps/fixtures/weather-agent` and `../packages/eve/src/public/index.ts`; neither ships in the npm package. These are repository-relative dead ends in installed docs.
- README says `init` installs and starts the development server. CLI docs qualify that coding-agent environments print next steps or launch a coding-agent REPL instead. Both can be true, but the behavior is context-dependent and not previewed in Quick Start.
- Provider/model selection is interactive implementation behavior, but `eve init` documents no model/provider flags. A repeatable human or CI path must scaffold and then edit configuration.
- The default HTTP API is enabled even without `agent/channels/eve.ts`, while init generates that file. This is intentional policy visibility, not a functional contradiction, but it makes the minimum file model look larger than it is.
- The docs explicitly serve coding agents through generated `AGENTS.md` and local package docs. That helps an agent enormously: paths name concepts, templates are inspectable, and there is a strict filesystem contract. Humans get a good short path, then a 21-page prescribed reading order whose breadth obscures the six-step task.

## C. boring-ui (ours)

### What was actually done

The requested repository was not modified. I consumed its already-built local packages from the scratch directory.

The named `boring-app-setup` and `boring-plugin-build` skills route this use case to a local runtime/generated plugin: the app is local, the tool/skill should hot reload, and no trusted server route is needed. Following the canonical plugin skill:

1. `status --json` confirmed workspace-local plugin roots and reload support.
2. `scaffold codebase-qa` generated a runtime plugin in `.pi/extensions/codebase-qa`.
3. I read the generated files.
4. I added `codebase_context` with `pi.registerTool`.
5. I added and declared a `codebase-qa` skill.
6. `verify` passed on the first run.
7. The real CLI attempted to start its full HTTP/UI app.
8. Because binding is forbidden, I exercised the same Fastify application with `app.inject`: workspace metadata, tool catalog, skills, plugin list, and reload all returned 200. The skill and plugin were discovered.
9. A real Pi session was created and a prompt was admitted. The terminal state failed while resolving the auth-store Vault command, before a model reply.

The runtime implementation lives at `/home/ubuntu/projects/spike-dx/boring/.pi/extensions/codebase-qa`.

### Step count

Clean path: **8 steps**.

1. Create/select workspace.
2. Run the mandated plugin status check.
3. Scaffold runtime plugin.
4. Edit manifest for system prompt + skill declaration.
5. Add the tool to the generated Pi extension.
6. Create the skill.
7. Verify.
8. Run `boring-ui <folder>`; UI and HTTP come together.

Observed study path: **14 steps**, adding generated-file inspection, server bind attempt, in-process HTTP probe, session-root recovery, one response-field correction, and final prompt retry.

### Files and lines

| File | Nonblank lines written/changed | Why |
|---|---:|---|
| `.pi/extensions/codebase-qa/package.json` | 4 | system prompt + skill path |
| `.pi/extensions/codebase-qa/agent/index.ts` | 12 | custom Pi tool |
| `.pi/extensions/codebase-qa/skills/codebase-qa/SKILL.md` | 9 | skill |
| **Total** | **25** | **3 files** |

The scaffold also generated `front/index.tsx` (125 nonblank lines), an agent slash command, and `.gitignore`. They are untouched and unnecessary for an agent-only tool/skill. That is generated bulk, not developer-written bulk, but it increases what a human must inspect and trust.

### Concepts and undefined terms

Six concepts/decisions precede implementation: host shape, workspace root, runtime mode, plugin trust tier, Pi-vs-server resource path, and provider auth-store setup.

Thirty specialized terms occur in the required docs without a definition at first or anywhere in that required set: **Pi, pi-coding-agent, Fastify, Dockview, SSE, HMR, Vite, bwrap, bubblewrap, Firecracker microVM, Drizzle, better-auth, TOML, Radix, CVA, shadcn, provider plugin, binding plugin, catalog, static composition, manifest discovery, core-based app, app shell, headless host, runtime binding, Vercel OIDC, blob storage, axe, Storybook, ETag**.

`PLUGIN_SYSTEM.md` does define app/internal plugin, runtime/generated plugin, plugin package, front factory, workspace server plugin, asset manager, revision, and surface resolver. That glossary is valuable and should be preserved.

### Every error and warning, verbatim, with grade

1. Vite deprecation warning:

   ```text
   `optimizeDeps.rollupOptions` / `ssr.optimizeDeps.rollupOptions` is deprecated. Use `optimizeDeps.rolldownOptions` instead. Note that this option may be set by a plugin. Set VITE_DEPRECATION_TRACE=1 to see where it is called.
   ```

   **ACTIONABLE**, but framework-internal and inappropriate onboarding noise.

2. Build-option warning:

   ```text
   Warning: Invalid input options (1 issue found)
   - For the "jsx". Invalid key: Expected never but received "jsx".
   ```

   **VAGUE**. It names neither owner nor file and gives no working fix.

3. Local bridge warning:

   ```text
   [BORING_WORKSPACE_BRIDGE_INSECURE_AUTH] Warning: createWorkspaceAgentServer is using createLocalCliBridgeAuthPolicy for WorkspaceBridge browser calls. This policy is unauthenticated, grants registered bridge capabilities to a fixed local-cli principal, and is intended only for local/dev CLI usage. Provide workspaceBridge.browserAuthPolicy before exposing this server.
   ```

   **ACTIONABLE**. It correctly describes scope and remediation, but expected loopback startup should not feel like a fault.

4. Listener:

   ```text
   listen EPERM: operation not permitted 127.0.0.1:5200
   ```

   **ACTIONABLE** environment error.

5. First session creation:

   ```json
   {"error":{"code":"INTERNAL_ERROR","message":"ENOENT: no such file or directory, mkdir '/home/ubuntu/.pi/agent/sessions/--home-ubuntu-projects-spike-dx-boring--'"}}
   ```

   **VAGUE**. The path is useful, but `INTERNAL_ERROR` and the message do not tell the developer to set `BORING_AGENT_SESSION_ROOT` to a writable directory.

6. Downstream response after failed creation and once after the study script read `sessionId` instead of returned `id`:

   ```json
   {"error":{"code":"SESSION_NOT_FOUND","message":"session not found"}}
   ```

   **VAGUE** in onboarding context. The required docs do not document the create-session response, so the `id`/`sessionId` mismatch was easy to make.

7. Unrelated global extension during session load:

   ```text
   Failed to register Ollama provider: TypeError: fetch failed
   ...
   [cause]: Error: getaddrinfo EAI_AGAIN ollama.com
   ```

   **MISLEADING**. The selected model was OpenRouter/Gemini, prompt admission continued, and this global provider failure was unrelated.

8. Terminal assistant state:

   ```text
   Failed to resolve API key for provider "openrouter" from shell command: vault kv get -field=api_key secret/agent/openrouter
   ```

   **ACTIONABLE**. This is the strongest ours-owned failure: exact provider and exact failing command. It should preserve the underlying socket denial too.

The 200 reload diagnostic was not an error and was excellent:

```text
No live agent session to reload yet — changes apply to the next session.
```

### Zero config versus required decisions

Zero config: folder workspace, direct filesystem/shell tools, file tree/editor/UI, Fastify routes, sessions, built-in HTTP server, plugin discovery, UI bridge, skill discovery, hot reload, and stable error envelopes. Unlike Flue, no app router or Vite file was needed. Like eve, HTTP is part of the runtime.

Required decisions: which of three app/host shapes to use, runtime mode, plugin tier, Pi extension vs trusted server tool, and auth-store provider. The skills force the plugin decision before files are written, which is safe but expensive for this small task.

### Docs assessment

There is a canonical human path from zero to the stock app in `packages/cli/README.md`: one `npx` command. There is **no single canonical path for this exact task**. A developer must cross the CLI README, agent tools docs, plugin-system spec, plugin-structure quick reference, plugin CLI README, two skills, and the Pi extension reference.

Concrete dead ends, staleness, and contradictions observed:

- The requested/current skill paths `.agents/skills/boring-app-setup` and `.agents/skills/boring-plugin-build` do not exist in the repo. They actually live under `skill-library/`. The skills themselves still link back to nonexistent `.agents/skills/...` paths.
- `PLUGIN_STRUCTURE.md` says runtime scaffold’s default shape includes `README.md` and does not mention `agent/index.ts` or `.gitignore`. Actual scaffold emitted `agent/index.ts` and `.gitignore`, with no README.
- `boring-plugin-authoring/SKILL.md` also says scaffold writes package/front/`.gitignore`; actual scaffold includes the agent entry.
- Scaffold output says “add `pi.extensions` / skills,” but `pi.extensions` is already present.
- The generated front plugin registers panel id `codebase-qa.page`; the generated Pi slash command attempts to open `codebase-qa.panel`. The default generated command is internally inconsistent before the developer edits anything.
- The custom-tool example calls the package `@boring/agent` in its heading while current imports/packages are `@hachej/boring-agent`.
- `verify` is honest that it checks only paths/manifests, but a command named verify leaving syntax/runtime validation to `/reload` + a live browser is too weak for the default workflow.
- The CLI README documents one automation HTTP endpoint but not the agent session/prompt/state API needed to make “reachable over HTTP” concrete.

The docs are primarily written for coding agents: routing tables, “read this first,” guardrails, progress disclosure, and imperative stop conditions. This helps an agent avoid invented plugin APIs. For a human it hurts: 3,000+ lines were in the explicitly required reading set, and the smallest task is hidden behind architecture for production apps, Vercel, Fly, core, provisioning, and UI composition.

## Ranked changes to our developer experience

Ranking uses estimated developer minutes saved divided by implementation effort. “Today” and “after” are deliberately operational.

| Rank | Change | Estimated save / effort | Today | After | Repo location |
|---:|---|---|---|---|---|
| 1 | Fix scaffold’s panel-id mismatch and add a golden test | 5–20 min / <1 hour | Fresh scaffold registers `<id>.page` but slash command opens `<id>.panel`; developer discovers it only in a live UI. | Both generated files share one canonical panel id; scaffold test fails on drift. | `packages/plugin-cli/templates/front-canonical.tsx`, `templates/agent-canonical.ts`, scaffold tests |
| 2 | Repair all skill paths and generated-shape docs | 5–10 min / <1 hour | Human follows `.agents/skills/...` paths that do not exist and reads three different claimed runtime layouts. | Every pointer resolves to `skill-library/...`; one generated-layout snippet matches actual package/front/agent/skill/ignore output. | `AGENTS.md`, `skill-library/boring-app-setup/**`, `skill-library/boring-plugin-build/**`, `packages/workspace/docs/PLUGIN_STRUCTURE.md`, `packages/pi/skills/boring-plugin-authoring/SKILL.md` |
| 3 | Add one exact “codebase agent + tool + skill + HTTP” quickstart | 15–30 min / 2–4 hours | Developer chooses among CLI, agent-playground, workspace-playground, full-app, extraTools, server plugin, runtime plugin, and several docs. | One page says: run CLI, scaffold `--agent-only`, edit these two stubs, verify, send this curl request. Advanced forks come afterward. | New `docs/web/getting-started/codebase-agent.md`; link first from `packages/cli/README.md`, `docs/README.md`, agent/tools docs |
| 4 | Add `scaffold --agent-only --skill <name>` | 8–15 min / 1 day | Agent-only task creates ~100 lines of unused React UI, a command, and a panel decision; developer edits three files manually. | Command emits package + Pi tool stub + `SKILL.md`, declares both, and omits `boring.front` and slash UI. Developer writes only tool behavior and skill procedure. | `packages/plugin-cli/src`, `packages/plugin-cli/templates`, CLI docs, `boring-plugin-authoring` skill |
| 5 | Make `verify` import/execute Pi extension registration and compile front code | 5–20 min per failure / 1–2 days | `verify` checks that files exist; syntax/API errors require server, `/reload`, diagnostics, browser, and `test`. | Default verify runs manifest checks plus isolated extension registration and front transform; “OK” means more than path existence. | `packages/plugin-cli/src/verify*`, runtime transformer reuse from `packages/cli/src/server/pluginFrontRuntime.ts` |
| 6 | Add `boring-ui doctor` and run its cheap checks at startup | 5–20 min / 1–2 days | Provider shell-command failure appears only after session creation and prompt admission; unrelated global provider failures add noise. | Startup reports selected/default provider, whether credential resolution succeeds, writable session root, and listener availability. Unselected provider failures are summarized separately. | `packages/cli/src/server/cli.ts`, `packages/agent/src/server/http/routes/models.ts`, Pi auth adapter |
| 7 | Publish the local HTTP happy path and response schemas | 10–20 min / 0.5–1 day | Developer reverse-engineers create-session response (`id`, not `sessionId`), prompt payload, model selection, and polling routes. | CLI README shows three curl commands and exact 201/202/state bodies; types link to canonical schemas. | `packages/cli/README.md`, `packages/agent/docs/API.md`, `packages/agent/docs/README.md` |
| 8 | Give session-store failures a stable, remedial error | 3–10 min / 2–4 hours | Unwritable `~/.pi/agent/sessions` becomes `INTERNAL_ERROR` + raw ENOENT. | `SESSION_STORE_UNWRITABLE`: path, underlying errno, and “set `BORING_AGENT_SESSION_ROOT` to a writable directory.” | `packages/agent/src/server` session-store adapter, `ERROR_CODES.md`, route tests |
| 9 | Remove expected startup warning noise | 1–5 min every run / 0.5–1 day | Normal localhost startup prints Vite deprecation, invalid JSX option, and a severe-looking local bridge warning. | Fix obsolete config; attach source to validation warnings; show local bridge as an informational line unless host is non-loopback. | CLI/workspace Vite config, runtime front host, workspace bridge warning site |
| 10 | Collapse the plugin-shape decision for local CLI work | 3–8 min / 0.5 day | Skills repeatedly ask runtime vs internal even when invoked inside folder-mode CLI with no trusted route request. | Context chooses runtime/generated automatically and prints the choice once; only asks when trusted server behavior is requested. | `skill-library/boring-plugin-build/DECISION_TREE.md`, `SKILL.md`, CLI environment/status metadata |

The highest-ratio work is not a new capability. It is deleting inconsistency and decisions: fix the generated id, make paths truthful, provide the one exact path, and stop generating UI for an agent-only extension.

## Where our DX is already better

- **Local codebase access is truly built in.** boring-ui’s CLI already has `read`, `grep`, `find`, `bash`, workspace rooting, UI, and HTTP. Flue required explicitly mounting a host sandbox; eve’s equivalent is built in but NOT-RUN here.
- **HTTP requires no application files.** Flue needed Hono, Vite, `@flue/vite`, a router, and a Vite config. boring-ui and eve expose HTTP as part of the runtime. Do not regress this while adding a quickstart.
- **Tool + skill hot reload is one trust-scoped package.** The manifest keeps the system prompt, Pi extension, and skill together and the runtime found the skill without dependency installation.
- **The verifier tells the truth about its limits.** Its warning that syntax/runtime failures require reload is unusually candid. Improve coverage without losing that explicitness.
- **Reload diagnostics are specific and calm.** “No live agent session to reload yet — changes apply to the next session” is better than a generic failure.
- **Stable HTTP error envelopes exist.** Even weakly classified failures carried codes such as `SESSION_NOT_FOUND`; Flue’s CLI failure was a raw stack. Preserve stable codes while making messages more remedial.
- **Credentials are not copied into every project.** Pi’s auth store can support several providers and subscriptions without a project `.env`. Keep that advantage; add a preflight and make shell-backed credential failures visible earlier.
- **The plugin docs have an explicit glossary and trust model.** Flue’s tool/skill docs are excellent at their own abstractions, and eve’s filesystem model is excellent, but ours is strongest about the security/lifecycle difference between runtime and app/internal plugins. Simplify the local path without erasing that distinction.

## Bottom line

Within the limits that could actually run, ours was faster to verified plugin/skill discovery and working in-process HTTP handlers than Flue: **41.5 seconds to verified discovery versus approximately 7 minutes 49.7 seconds to Flue’s typechecked equivalent in this failure-heavy environment**. The honest reply measurement is **NOT-RUN for both**, and eve is **entirely NOT-RUN**.

Our advantage is integration: codebase tools, workspace, UI, plugins, and HTTP already compose. Our disadvantage is decision and documentation surface. A human should not need to understand the full plugin trust architecture, three app shells, static composition, provisioning, and two skill routers to add one local tool and one skill. Preserve the integrated runtime; remove the choices, stale paths, generated UI, and late diagnostics.
