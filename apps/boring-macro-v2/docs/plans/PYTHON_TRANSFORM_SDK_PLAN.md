# Macro transform skill — implemented shape

**Status:** shipped
**Last updated:** 2026-04-29

The original longer plan is obsolete. boring.macro now uses a **skill-first**
workflow for derived-series creation.

## Final architecture

- Workspace provisioning seeds:
  - `.agents/skills/macro-transform/SKILL.md`
- Agent uses that skill when asked to create a derived series.
- Python is used for **compute**.
- boring.macro API is used for **read + write**.
- TypeScript app remains the **single persistence owner**.
- `transform_spec` supports richer metadata.
- Eval validates the minimal prompt path:
  - `create a derived series for CPI`

## Shipped pieces

- Workspace-template seeded skill:
  - `src/plugins/macro/workspace-template/.agents/skills/macro-transform/SKILL.md`
- Persist route/tool support for richer `transform_spec`
- Eval:
  - `eval/macro-transform-skill.yaml`
  - `eval/run.ts`
- Build-server test proving seeded skill presence

## Optional future work

- Batch fetch endpoint for multi-series transforms
- Helper runner script for less Python boilerplate
- UI affordance for creating derived series directly from the app
- Event-bus polish after persist

## Canonical rule

For derived macro series:

- prefer the seeded `macro-transform` skill
- create reusable transform files
- do not hand-build observation arrays in chat unless explicitly asked
