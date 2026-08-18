# Harvest — DeepSeek Harness v0.1 (dsh)

Scouted 2026-08-14. Released 2026-08-13, MIT, developer preview, explicit
"THERE WILL BE COMPATIBILITY-BREAKING CHANGES".
Repo: github.com/deepseek-ai/deepseek-harness · `npx @deepseek-ai/dsh web` (127.0.0.1:3080)

## What it is

A plugin-first agent runtime built on **vendored Cordis** (cordiverse/cordis) —
"plugins contribute services, typed events, and reversible effects to a shared
context". Model adapter, tool registry, session log, and *the agent loop itself*
are plugins. Ships models, tools, skills, sessions, sandboxes, storage,
orchestration, and a web UI. Python and native SDKs for out-of-process plugins.

This is the closest competitor yet to **our** architecture — not to pi. It targets
the same layer as `packages/workspace` plugin system + `agent-host` composition.

## The four ideas worth taking

1. **"Model-visible means logged."** Anything reaching a model request must be
   reconstructible from the session log. New model-visible input ⇒ new session
   event, no exceptions. Their persistence catalog is ~60 event types, generated
   from source, with a surface/log-only split (`user/message` derives an LLM
   message; `hook/invoked` does not).
2. **Capability seam = three roles shipped together.** Owner (interface),
   Implementation(s), Consumer. Seams split only when the roles evolve
   independently. Three service classes: *seam* (`ctx.llm`, `ctx.shell`,
   `ctx.sandbox` — swappable), *core* (`ctx.sessions`, `ctx.tools` — singular),
   *bundle* (`ctx.agentLoop` — composes).
3. **"Runtime invariants over static checks."** Validate authoritative event
   streams and mutable data. Do not rely on service presence or metadata
   inspection as proof.
4. **Profiles / bundles / patch layers.** A profile is a named local composition;
   layers apply to an empty entry list in order (bundles from profile, then
   patches at several levels). Customization without forking.

## Also noted

- `ctx.effect()` / `ctx.on()` return disposers — every contribution reversible.
- Tool pipeline is waterfalls: `tools/pre-execute` (hooks, permission, sandbox) →
  guards + `ctx.approval` one-shot → `tools/execute` (timeout, retry) →
  `fs/write-intent` / `fs/edit-intent` gates → `tools/post-execute` (accept,
  block, replace, add-context) → `tools/result`. Denied tools skip the body but
  still run post-processing.
- Defensive rules are written as bans: scrubbed env for spawned commands
  (drop `*KEY*`/`*SECRET*`/`*TOKEN*`/`*PASSWORD*`); 0700 temp dirs, `wx`+0600;
  never `rmSync` a path without an `lstatSync().isSymbolicLink()` check;
  orthogonal outcome reporting (`timedOut`/`signal`/`exitCode` each on its own);
  teardown closes registries *before* killing children then awaits exit.
- `SESSION_FORMAT_VERSION = 0`, pinned; they bump only on structural change.

## What they do NOT have

No tenancy, no authorization subject, no per-workspace scope. Same gap as Flue
and eve. Our capability model is still the differentiator — the field keeps
confirming this.
