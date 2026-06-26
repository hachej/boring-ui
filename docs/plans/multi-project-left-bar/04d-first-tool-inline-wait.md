# 04d — First Tool/File Command Inline Wait

## Purpose

If the user sends a message/command before runtime preboot is complete, the chat/tool step should wait inline instead of failing, rolling back the user message, or showing a page loader.

Depends on:

- 04c runtime preboot endpoint;
- existing readiness/tool execution path understood.

## Review budget

Target non-test/non-doc added LOC: **< 2,500**.
Hard cap for PR review: **< 15,000** non-test/non-doc added LOC.

## Current risk

The prompt path may hydrate session state before posting a prompt and can time out/rollback optimistic messages if runtime readiness is slow. That conflicts with the desired UX:

- user sees target chat;
- user sends first command;
- if tools/runtime are not ready, command waits inline with a preparing state;
- user message is not lost.

## Scope

- Identify existing readiness gate for prompt/tool/file commands.
- Ensure runtime-preboot pending state produces inline chat/tool readiness UI.
- Preserve optimistic user message as pending.
- Proceed automatically when runtime becomes ready.
- Avoid page-level loader.

## Implementation options

1. Extend existing runtime/tool readiness notices if available.
2. Add a pending turn state for `runtime-preparing`.
3. Increase/retry timeout only if paired with visible inline state; do not silently hang.

## Tests / acceptance

- Simulate preboot pending.
- User sends message.
- User message remains visible as pending.
- Inline preparing state appears.
- No page/content takeover.
- Once runtime ready, prompt proceeds.
- At least one tool/file-command path while preboot is pending shows inline waiting, not page takeover.
- Tool/file command proceeds automatically when ready.
- If runtime fails, pending turn becomes stable retryable error with retry affordance.

## Out of scope

- Starting preboot (04c).
- No-boot transcript route (04b).
- General chat UI rewrite.

## Risks

- Do not paper over runtime errors forever. Pending state needs timeout/error path.
- Avoid duplicating readiness concepts. Reuse existing readiness tracker/notice if possible.
