# Upstream request: the phase-resolved tool on `HookApi`

Status: draft, not filed. Owner: boring-ui sandbox (`@hachej/boring-agent/sandbox`, PR #1656).

## Problem

A `beforeTool` hook (`hook(ToolTask, { beforeTool })`) receives `HookApi`, which has `taskId`, `conversationId`, `models`, `memo` and the document reader. It cannot see the tool that the executing phase will run. The composed tool is the result of every selected extension's `wraps` applied in order. Its `execute` is what runs.

Consequence for a fail-closed wrapper: an extension selected after the wrapper can replace the wrapper's `execute` (for example a converting read). The hook cannot detect that replacement, so the replaced call runs for real. Boring's sandbox must therefore assume the host orders extensions correctly.

Pi 1.1 exposes `agent(context)` on `TaskRuntime`, `ToolExecutionApi` and `Conversation`. It is not typed on `HookApi`. The tool task passes its runtime to hooks, so an implementation can reach it, but that is not a documented contract, and Boring does not use it (BORING-PI-4).

## Request

Expose the phase-resolved composed tool, or the phase-resolved agent, on `HookApi` for `ToolHooks.beforeTool`. Either would let a wrapper check at call time that the tool about to run is its own wrapper.

Acceptable shapes, in order of preference:

1. `beforeTool(call, api, context)` where `api.tool` (or `api.agent(context)`) returns the tool the phase resolved, after all wraps.
2. The same, typed on `HookApi` and documented as a supported hook contract.

## Non-goals

- No change to wrap order or to replacement semantics.
- No hook that can veto a wrap at composition time.

## Boring-side behaviour until supported

- The sandbox states the composition limit in its module documentation and README.
- `assertSandboxLast(selected, sandbox)` checks the order at setup over the public `Extension.wraps` shape. The host must call it.
- The name gate in `beforeTool` remains and holds at call time.
