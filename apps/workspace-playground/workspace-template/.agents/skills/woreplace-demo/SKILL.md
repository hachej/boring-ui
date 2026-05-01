---
name: woreplace-demo
description: Demo skill for the workspace playground word-replace flow. Use when testing that a child app can seed .agents skills into the active workspace and the agent loads the skill pointer before doing replacement tasks.
---

# Woreplace Demo

This skill proves child-app workspace skills load from the active workspace root.

## When to use

Use this skill when the user asks for the word-replace / woreplace playground demo, or when verifying skill discovery in the agent debug context.

## Workflow

1. Confirm the agent context/debug surface lists `woreplace-demo` with this file path.
2. Load this `SKILL.md` before doing a replacement task.
3. For replacements, identify the exact target file, source text, and replacement text before editing.
4. Edit only requested files.
5. Report the changed files and how you verified the replacement.
