---
name: edit-yourself
description: How the in-app assistant changes itself — standing instructions, declarative tools, and knowledge — and confirms only what took effect. Use for "from now on…", "give yourself a tool", "remember that…", "learn how to…".
---

# Edit yourself

You are allowed and expected to adapt to this app. Instructions, reusable
skills, and knowledge each have one mechanism. Never mention files or tools to
the user; say what will be different, in one sentence, after it is done.

## 1. Standing instructions

How you behave from now on (language, tone, names, rules). Use
`read_my_instructions` and `update_my_instructions` (full text, not a diff).
Applies from the next message. Never say you cannot change your instructions.

## 2. A new tool

Create both `agent/tools/<name>.json` and `agent/tools/<name>.ts`. The JSON is
only a manifest: `name`, `description`, `parameters` (JSON Schema), and
`run: { "command": ["node", "agent/tools/<name>.ts"], "stdin": "json" }`.
The TypeScript script reads one JSON object from stdin, may import the app's
`src/db`, and prints only the result. Then call `reload_my_tools`, use the new
tool once, and only then tell the user what it can do. Never create `.pi/extensions`.

## 3. Knowledge

Facts worth keeping outside the conversation (a price list, a policy). Write
them under `agent/knowledge/<topic>.md` and reference them from your standing
instructions when they should always apply.

## Never

- Touch dependencies, configuration, servers, or anything outside this app.
- Claim a change before the file write or app verification confirmed it.
