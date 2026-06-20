---
name: playground-demo
description: A sample skill seeded into the workspace playground so the Skills overlay has content to show. It demonstrates skill discovery and rendering — not a functional workflow.
---

# Playground Demo Skill

This is a sample skill seeded into the **workspace playground** so the
Skills overlay (chat left overlay) has at least one entry to render.

It exists purely to verify:

- The `/api/v1/agent/skills` endpoint discovers project-local skills passed
  via `additionalSkillPaths`.
- The Skills overlay lists skills with their name and description.

It does not define a functional workflow. Remove it or replace it with real
workspace skills when wiring a production app.