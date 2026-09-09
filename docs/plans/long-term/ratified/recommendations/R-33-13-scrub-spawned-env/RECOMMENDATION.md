# R-33-13 — Scrub the environment handed to spawned commands

Status: proposed · Source: DeepSeek `docs/defensive-patterns.md`
Kind: bug (security) · Cost: **medium** · Priority: **P2** (revised 2026-08-14 after PR #1256 review)

## Claim

Adopt the mandated rule: *spawned commands get a scrubbed env — drop `*KEY*`,
`*SECRET*`, `*TOKEN*`, `*PASSWORD*`.* Our direct sandbox provider does the
opposite: it hands the child a snapshot of the entire host environment.

## Why

The chain, verified on `main` 2026-08-14:

```
createDirectSandbox.ts:100   env: withWorkspacePythonEnv({ ..., preserveHostHome: true })
workspacePythonEnv.ts:30       const baseEnv = env ?? getEnvSnapshot()
runtimeSupport.ts:12           export function getEnvSnapshot() { return { ...process.env } }
```

`opts?.env` is optional, so the default path is the full host environment.
`preserveHostHome: true` additionally keeps `HOME`, which is where agent
credential files live. On this machine that env contains `VAULT_TOKEN`,
`ANTHROPIC_API_KEY` and a GitHub token — all reachable by any command the model
chooses to run through the direct provider.

Grepping `packages/boring-sandbox/src` for scrubbing turns up nothing: the only
`SECRET` hits are a `dockerRunner` test assertion and remote-worker protocol
error codes. There is no allowlist and no denylist anywhere in the provider.

## Evidence

- `packages/boring-sandbox/src/providers/direct/createDirectSandbox.ts:100`
- `packages/boring-sandbox/src/providers/node-workspace/workspacePythonEnv.ts:30,35`
- `packages/boring-sandbox/src/providers/runtimeSupport.ts:12`
- `git grep -n 'SECRET|scrubEnv|redactEnv' packages/boring-sandbox/src` → no scrubbing implementation.
- DeepSeek: *"Spawned commands get a scrubbed env (drop `*KEY*`/`*SECRET*`/`*TOKEN*`/`*PASSWORD*`)."*

## Revision — 2026-08-14, after PR #1256 review

Two corrections from the reviewer, both accepted:

1. **Not a one-field change.** Env inheritance flows through at least four paths:
   `createDirectSandbox.ts`, boring-bash's direct spawn hook, provisioning
   subprocesses, and runtime environment contributions. Declaring an `env` field
   on the descriptor without enforcing all four would be a **false security
   claim** — worse than the current honest absence.
2. **The inheritance is partly intentional.** `direct` mode deliberately carries
   host auth so `gh` and `git` work. A `PATH`/`HOME`/`LANG` allowlist breaks that
   on purpose. So the defect is **not** "credentials leak" but "env inheritance
   is undeclared and unbounded" — a narrower and more accurate claim.
3. **Production admission already covers full-app.** `direct` has
   `host.productionSafe: false`, enforced by `assertProductionAgentModeIsSafe`.
   That gate is full-app-only and escapable via `BORING_ALLOW_UNSAFE_AGENT_MODE=1`,
   so exposure is real but bounded.

Revised: **P2 follow-up with end-to-end implementation and tests across all four
paths**, not a descriptor field bolted onto PR #1256.

## What it costs

Medium, revised from low — A deny-pattern filter in `getEnvSnapshot`'s callers, plus an explicit
allowlist for the vars the workspace genuinely needs (`PATH`, `HOME` if
`preserveHostHome`, the Python runtime vars that function already sets).
Prefer an **allowlist** over DeepSeek's denylist — their four patterns miss
`VAULT_ADDR`, `AWS_*`, and `GH_*`.

## What it breaks

Anything currently relying on ambient credentials inheriting into a sandboxed
command. That is the vulnerability, but it may be load-bearing for the
BYOK-less local dev path, so land it with a `BORING_SANDBOX_INHERIT_ENV` escape
hatch that is off by default and logged when used.

## Refutation

If the direct provider is only ever reachable in single-tenant local dev where
the user already owns every credential in the environment, this is a hardening
nit, not a defect. Check: is `createDirectSandbox` reachable in any deployed
multi-tenant configuration? That determines whether this is P1 or P3, and it is
one call-site trace away.
