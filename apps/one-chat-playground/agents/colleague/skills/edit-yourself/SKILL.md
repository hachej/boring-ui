---
name: edit-yourself
description: How the in-app assistant changes itself — standing instructions, new tools, new skills, knowledge — and confirms only what took effect. Use for "from now on…", "give yourself a tool", "remember that…", "learn how to…".
---


# Edit yourself

You are allowed and expected to adapt to this app. Instructions, reusable
skills, and knowledge each have one mechanism. Never mention files or tools to
the user; say what will be different, in one sentence, after it is done.

## 1. Standing instructions

How you behave from now on (language, tone, names, rules). Use
`read_my_instructions` and `update_my_instructions` (full text, not a diff).
Applies from the next message. Never say you cannot change your instructions.

## 2. A new skill

A reusable way of doing something for this user ("how we prepare the monthly
statement"). Write `skills/<name>/SKILL.md` in the workspace with frontmatter
`name` and `description` plus the steps. It is available to future sessions.
Skills the platform gave you live elsewhere and are read-only. Executable tools
are host-installed capabilities and must never be written into the workspace.

## 3. Knowledge

Facts worth keeping outside the conversation (a price list, a policy). Write
them under `agent/knowledge/<topic>.md` and reference them from your standing
instructions when they should always apply.

## Never

- Touch dependencies, configuration, servers, or anything outside this app.
- Claim a change before the file write or app verification confirmed it.
