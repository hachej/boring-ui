# Troubleshooting map

This page is for the recurring bug classes that kept showing up in recent boring-ui v2 work: workspace boot issues, plugin reload confusion, session drift, and runtime-mode surprises.

Use it as a fast triage map, then jump into the canonical package docs.

## 0. Fly deploy is broken after release

**Typical symptoms**
- Fly release command failed
- deployed app is up but `/health` or smoke checks fail
- Vercel sandbox mode works locally but not in the deployed full app

**Look here first**
- `docs/FIXES.md` for recent production/runtime fix entries
- `apps/full-app/README.md`
- `packages/core/docs/DEPLOYMENT_WORKFLOW.md`

**What is usually true**
- Today, `apps/full-app/fly.toml` runs `migrate.js` as the release command.
- `release.js` and deployment snapshots are target-shape docs unless a specific app has wired them.
- Fly uses `BORING_AGENT_MODE=vercel-sandbox` and `BORING_AGENT_WORKSPACE_ROOT=/data/workspaces`; Vercel sandbox credentials still need to be configured as secrets.
- Pi chat transcripts still live on the Fly host volume at `BORING_AGENT_SESSION_ROOT` (normally `/data/pi-sessions`), even in `vercel-sandbox` mode. If you see `EACCES mkdir /data/pi-sessions/...`, check the fix ledger entry for mounted-volume ownership repair.
- Post-deploy validation runs through `pnpm --filter full-app smoke:post-deploy` with `DEPLOY_URL` and `SMOKE_*` vars.

## 1. Workspace never finishes booting

**Typical symptoms**
- stuck on "Preparing workspace"
- direct `/workspace/:id` loads the shell but panes stay empty
- chat appears before the workbench is ready, or the reverse

**Look here first**
- `packages/core/docs/CHAT_FIRST_WORKSPACE_BOOT.md`
- `packages/core/docs/README.md`
- `packages/workspace/docs/README.md`

**What is usually true**
- Core owns identity and workspace gating.
- Workspace owns local warmup and pane readiness.
- Agent readiness is background state, not the route authority.

**Common mistake**
Treating URL state or a front-end session id as the source of truth. The route must be gated by the current authenticated workspace identity, then the workspace/agent surfaces warm underneath it.

## 2. A plugin changed, but `/reload` did not apply it

**Typical symptoms**
- front panel stays stale after `/reload`
- plugin routes or tools do not change until restart
- one broken plugin prevents confidence in the rest of the system

**Look here first**
- `packages/workspace/docs/PLUGIN_SYSTEM.md` §1.1 and §4.5
- `packages/workspace/docs/README.md`
- `packages/agent/docs/PLUGINS.md`

**What is usually true**
- Runtime/generated plugins under `.pi/extensions/*` hot-reload only for front + Pi resources.
- App/internal plugins can add routes and static agent tools, but those are boot-time only.
- Runtime plugin loading is a local/direct-style host workflow, not `vercel-sandbox`.
- `/reload` is partial-failure tolerant: one plugin can fail while healthy plugins still update, and server drift may surface `requiresRestart` while front/Pi reload still succeeds.
- Check the `/reload` chat response for `requiresRestart`, plugin SSE diagnostics, and `/api/v1/agent-plugins/:id/error`; a failed front import should keep the previous UI live where possible.

**Common mistake**
Expecting generated/runtime plugins to hot-add Fastify routes or host-process `agentTools`. That path is intentionally not implemented.

## 3. A tool or slash command is missing

**Typical symptoms**
- tool shows in docs but not in the running catalog
- slash command exists in a skill/resource but not in chat
- custom tool works in one app shape but not another

**Look here first**
- `packages/agent/docs/tools.md`
- `packages/agent/docs/PLUGINS.md`
- `packages/workspace/docs/PLUGIN_SYSTEM.md` §4.7
- `packages/pi/references/workspace/plugins.md`

**What is usually true**
- Standalone agent tools come from built-ins plus `createAgentApp({ extraTools })`.
- Workspace-composed static tools come from `defineServerPlugin({ agentTools })`.
- Hot-reloadable chat behavior belongs in Pi resources (`extensions`, `skills`, `systemPrompt`).
- Pi resources also drive chat slash commands.

**Common mistake**
Using the wrong extension path. If you need restart-free behavior, do not put it in a boot-time server plugin.

## 4. File operations or tree views are looking at the wrong place

**Typical symptoms**
- `read`/`bash`/tree disagree about the current workspace root
- a runtime mode works locally but paths break in `local` or `vercel-sandbox`
- model-visible cwd leaks host-private paths

**Look here first**
- `packages/agent/docs/runtime.md`
- `docs/DECISIONS.md` decision 7
- `docs/web/reference/design-faq.md`

**What is usually true**
- `Workspace.root`, shell cwd, model-visible cwd, and `BORING_AGENT_WORKSPACE_ROOT` must describe the same public workspace namespace.
- Path validation belongs to the adapter, not the caller.
- Workspace and Sandbox must be swapped as a pair.

**Common mistake**
Passing raw paths around higher-level code or mixing a workspace adapter with a sandbox that sees a different filesystem substrate.

## 5. Direct mode behaves differently than expected

**Typical symptoms**
- behavior differs between host mode and sandboxed modes
- a command works in direct mode but fails in `local` or `vercel-sandbox`
- paths or env details look different once isolation is enabled

**Look here first**
- `packages/agent/docs/runtime.md`
- `packages/agent/docs/README.md`

**What is usually true**
- `direct` mode is the real host workspace path and preserves host-oriented behavior such as existing CLI auth/home context.
- `local` and `vercel-sandbox` expose `/workspace` to the model.
- Direct mode is intentionally trusted/local-dev oriented.

**Common mistake**
Assuming all modes should expose identical host env details. The mental model stays the same, but the adapter boundary is real.

## 6. Session behavior is weird across reloads or multiple clients

**Typical symptoms**
- session list goes stale after a server restart
- two clients race on one session
- browser URL/session state falls out of sync

**Look here first**
- `packages/agent/docs/API.md`
- `packages/agent/docs/README.md`
- `docs/WORKSPACE_CONTRACT.md`

**What is usually true**
- Session lifecycle is server-owned.
- UI display parts are not the command authority.
- Workspace state sync must flow through the documented bridge/session endpoints, not through ad hoc URL coupling.

## 7. Agent opened the wrong UI surface

**Typical symptoms**
- agent names a panel id directly and breaks app flexibility
- plugin surface opens inconsistently across apps
- file/domain actions bypass the intended resolver

**Look here first**
- `packages/workspace/docs/README.md`
- `docs/WORKSPACE_CONTRACT.md`
- `packages/workspace/docs/PLUGIN_SYSTEM.md`

**What is usually true**
- `openSurface` is the domain-level path.
- Surface resolvers map domain targets to concrete panels.
- `openPanel` is for intentionally concrete panel ids.

**Common mistake**
Encoding product/domain behavior directly into panel ids.

## 8. An editor or preview renders blank/unstyled in prod but works locally

**Typical symptoms**
- a component (e.g. the CodeMirror code editor) mounts but is blank and uninteractive in prod
- gutters/line numbers show, but the content area is empty and you can't type
- it works perfectly when run locally against the Vite dev server

**Root cause**
Production sends a strict, **nonce-only** Content-Security-Policy. `style-src` is
`'self' https://fonts.googleapis.com 'nonce-<per-request>'` — there is **no
`'unsafe-inline'`** (see `packages/core/src/server/app/createCoreApp.ts`). Any library
that injects a `<style>` tag at runtime must stamp it with the request nonce, or the
browser silently drops the styles. Local dev does not enforce this — the dev policy is
`style-src 'self' 'unsafe-inline'` (`packages/agent/src/server/http/csp.ts`), so inline
styles work unconditionally and the bug is invisible locally.

The nonce is published to the page as `<meta name="boring-csp-nonce" content="…">`
(injected in `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`) and matches
the CSP header. Front-end code reads it and forwards it to the library:
- **CodeMirror** — `EditorView.cspNonce.of(nonce)`
  (`packages/workspace/src/plugins/filesystemPlugin/front/code-editor/CodeEditor.tsx`,
  fixed in PR #343).

**Whether it breaks visibly depends on whether the injected styles are load-bearing**
- **Load-bearing** (CodeMirror: layout + `.cm-content` contentEditable sizing) → hard
  break, blank and unusable.
- **Non-load-bearing** (TipTap markdown editor: real styling comes from the bundled
  `tiptap-prose` stylesheet loaded as a normal `'self'` sheet; TipTap's own injected
  defaults are minor) → no visible break even though the tag is dropped. Verified working
  in prod, so it does **not** need a nonce today.

**What is allowed**
- inline `style="…"` **attributes** are permitted via `styleSrcAttr: 'unsafe-inline'`
  (kept so DockView/React runtime layout sizing survives). Only `<style>` **tags** need a
  nonce.
- there is no `'unsafe-eval'` and `connect-src` is `'self'` only — `eval`/`new Function`
  and cross-origin fetches will also be blocked.

**If you add a new runtime-style-injecting library**
Read the nonce from the meta tag and pass it through the library's nonce option. One
still-unverified spot is mermaid diagram rendering in agent chat (`@streamdown/mermaid`),
whose SVG `<style>` is the same load-bearing kind — check it if diagrams look unstyled in
prod.

## 9. "Where should this feature live?"

Use this fast rule:
- needs DB, auth, membership, or durable app identity → `@hachej/boring-core`
- needs LLM runtime, tools, sessions, or execution mode work → `@hachej/boring-agent`
- needs panes, tabs, layout, bridge, plugin outputs, or catalog UX → `@hachej/boring-workspace`

Then confirm with:
- `docs/web/architecture/package-map.md`
- `packages/core/docs/README.md`
- `packages/agent/docs/README.md`
- `packages/workspace/docs/README.md`
