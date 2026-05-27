---
name: boring-app-setup
description: Scaffold, customize, and ship a new boring-ui app from an idea. Covers choosing the right reference app, creating app identity, wiring plugins, configuring auth/mail/domain/env, and deploying with smoke checks. Use when the user wants a new boring-ui app, a child app, a branded deployable shell, or asks to go from idea to shipped app.
---

# Boring App Setup

Use this skill as a **router first**.
Read the relevant reference file before answering architecture, provider, or plugin-shape questions.

## Default rule

**Default to `apps/full-app` for anything that should become a real product.**

Use another base only when the user clearly wants:

- `apps/workspace-playground` — plugin/workbench prototype
- `apps/agent-playground` — chat/agent-only app

## Routing table

| Need | Read first | Then use |
|---|---|---|
| choose the child app shape | `references/app-shape.md` | `playbooks/EXECUTION_PLAYBOOK.md` |
| map external dependencies | `references/dependencies.md` | `references/providers/*.md` |
| choose plugin path | `references/plugin-paths.md` | `.agents/skills/boring-plugin-build/SKILL.md` |
| decide where logic should live | `references/ownership.md` | `references/transport.md`, `references/routes.md` |
| decide runtime + deploy shape | `references/runtime-and-provisioning.md` | `references/providers/vercel.md`, `references/providers/fly.md` |
| decide data/migrations | `references/persistence.md` | `playbooks/CHECKLISTS.md`, `playbooks/EXECUTION_PLAYBOOK.md` |
| verify readiness | `references/acceptance.md` | `playbooks/CHECKLISTS.md` |

## Provider routing

| Need | Read |
|---|---|
| managed Postgres | `references/providers/postgres.md` |
| mail delivery | `references/providers/mail-transport.md` |
| sender domain / `MAIL_FROM` | `references/providers/sender-identity.md` |
| generic hosted baseline | `references/providers/vercel.md` |
| our custom always-on setup | `references/providers/fly.md` |
| model/API provider | `references/providers/model-providers.md` |

## Operating files

- `playbooks/EXECUTION_PLAYBOOK.md` — phase-by-phase execution loop
- `playbooks/PROGRESS_DISCLOSURE.md` — how to report status clearly
- `playbooks/CHECKLISTS.md` — creation / deploy / verification checklists

## Plugin references

- `.agents/skills/boring-plugin-build/SKILL.md`
- `packages/pi/skills/boring-plugin-authoring/SKILL.md`
- `packages/cli/templates/plugin/README.md`
- `packages/cli/README.md`

## Rule

Do not answer from memory when the question is about app shape, dependencies, providers, plugin path, routes, transport, or migrations.
Read the matching reference first.
