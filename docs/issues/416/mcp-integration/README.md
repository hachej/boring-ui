# Issue #416 — MCP Integration Pack

This folder tracks the generic MCP onboarding work for issue #416.

Goal: make it easy to onboard any MCP server, with Notion and Airtable as first templates, while keeping boring-ui/Constellation in control of auth, tool policy, audit, and future governance.

## Files

- `plan.md` — implementation plan for generic MCP onboarding foundation.
- `reviews/` — thermo review outputs.

## Key decision

Use OpenClaw as the product/control-plane inspiration:

- central MCP registry;
- add/configure/login/logout;
- status/doctor/probe;
- tool filters;
- runtime projection.

Use `pi-mcp-adapter` as implementation inspiration:

- MCP transports;
- lazy lifecycle;
- metadata/tool discovery;
- proxy-tool pattern.

Do **not** rely on raw global Pi extension config for hosted multi-user production.
