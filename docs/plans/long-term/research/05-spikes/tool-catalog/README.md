# pi host-side tool catalog spike

Node 22 / Vitest executable proof for GitHub issue #1226 against pinned
`@earendil-works/pi-agent-core@0.80.7`.

```sh
pnpm install
pnpm test
pnpm run spike:offline

export VAULT_ADDR=http://127.0.0.1:8200
export VAULT_TOKEN="$(cat ~/.vault-token)"
export GEMINI_API_KEY="$(vault kv get -field=api_key secret/agent/gemini)"
export GOOGLE_API_KEY="$GEMINI_API_KEY"
pnpm run spike
```

`artifacts/` contains exact event hooks, runtime tool events, pi provider payloads,
and (when transport is reachable) serialized Gemini wire request bodies. For a
deterministic no-network transport exercise, set `GEMINI_API_KEY=dummy` and
`MOCK_GOOGLE=1`; this validates serialization and runtime plumbing but is not a
model-behavior proof and intentionally reports provider token counts as `null`.
