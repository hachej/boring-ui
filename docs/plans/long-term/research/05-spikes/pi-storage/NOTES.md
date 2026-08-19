# pi host-storage spike

## Verdict

The Flue persistence pattern is available on the pinned `@earendil-works/pi-agent-core@0.80.7`. No upgrade is required.

`SessionStorage`, `Session`, and `AgentHarness` are public types/classes in 0.80.7. The spike injects `HostSessionStorage` into `Session`, then injects that `Session` into `AgentHarness`. Pi never creates or opens its default session storage.

The higher-level `@earendil-works/pi-coding-agent@0.80.7` `SessionManager` is not storage-adapter injectable. It is not, however, unconditionally file-backed: `SessionManager.inMemory()` is public, and `createAgentSession()` accepts a supplied `SessionManager`. The clean host-durable seam is `pi-agent-core`, not coding-agent's legacy `SessionManager`.

## Run

```sh
pnpm install
pnpm test
pnpm run proof:offline

export VAULT_ADDR=http://127.0.0.1:8200
export VAULT_TOKEN="$(cat ~/.vault-token)"
export GEMINI_API_KEY="$(vault kv get -field=api_key secret/agent/gemini)"
pnpm run spike
```

The offline proof uses pi-ai's faux provider only to make the persistence and process-boundary proof deterministic. It runs turn 1 and turn 2 in different Node processes and makes turn 2 inspect model context for the nonce from turn 1.

In this managed execution sandbox, both Vault loopback access and the Gemini provider fetch were blocked. The real Gemini command therefore produced `stopReason: "error"`, `errorMessage: "fetch failed"`. This is an environmental failure, not a successful Gemini proof; see the full report for verbatim output.

## Files

- `src/host-session-storage.js`: minimal append-only JSONL host storage implementing the public `SessionStorage` contract.
- `src/turn-worker.js`: one pi turn in one process; supports `gemini` and deterministic `faux` modes.
- `scripts/run-two-process-proof.sh`: runs two fresh processes, asserts continuity, and hashes the full default session tree before/between/after.
- `test/host-session-storage.test.js`: replay/unit test using the pinned `Session` implementation.

## Runtime requirements and caveats

- The harness requires an `ExecutionEnv`, even with no tools. This spike supplies `NodeExecutionEnv`, which assumes Node, a valid `cwd`, filesystem APIs, temp storage, shell/process APIs, environment variables, and a clock/random UUID source.
- With `tools: []`, the turn path did not invoke filesystem or shell methods, but the environment object remains a constructor requirement.
- Real provider turns require outbound HTTPS and provider credentials.
- The adapter must implement pi's leaf semantics precisely: ordinary `appendEntry()` advances the leaf; `setLeafId()` appends a `leaf` entry whose `targetId` becomes active.
- Concurrent host writers need serialization/transactions. This minimal JSONL adapter assumes one writer at a time.
- The local install attempt was blocked because pnpm could not open its global store database in this sandbox. The checked-in `package.json` has exact dependencies; local symlinks to the already-installed pinned artifacts were used for execution here.
