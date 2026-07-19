# Trusted authored-agent example

Minimal A1 v1 agent directory:

- `agent.json` declares identity, `instructions.md`, and opaque trusted tool refs.
- `instructions.md` is the only authored prompt asset.
- `tools/not-imported.mjs` is a sentinel proving generic A1 does **not** discover or import authored executable modules. The trusted host supplies the `claims.lookup` implementation from server code instead.

Validate from the repo root after building the CLI:

```bash
node packages/cli/dist/index.js agent validate packages/agent/examples/trusted-authored-agent --json
```
