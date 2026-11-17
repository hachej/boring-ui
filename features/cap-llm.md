# One model call (cap-llm)

A plain import any app can call, with no Effect, no host and no framework: `complete` (text) and `structured` (an answer checked against a closed JSON schema), plus `llmTool`, the pi-durable tool built from the same function. It makes one call outside a conversation; a conversation is an agent's job. A key comes only from what the caller passes.

## Sub-features

- `llm-complete-structured` `complete(input, options)` and `structured(input, options)` from `@hachej/boring-agent/caps/llm`: providers `fake` or `<pi provider id>:<model id>`, a result `{ ok: true, ..., provider, region, counted }` or a refusal `{ ok: false, kind, retryable }`, never a throw. `packages/agent/src/caps/llm/index.ts`.
- `llm-checked-answer` the structured answer is parsed and checked, with one corrective turn; closed schemas only (`invalid-schema` before any request). The checker is the Factory's, copied unchanged in `packages/agent/src/caps/llm/structured-port.ts`.
- `llm-limits` purpose, 50 messages, 200,000 characters, 32,000 tokens (capped at the model's own maximum), 600 s, no unknown field: refused before anything is sent.
- `llm-native-format` for an Anthropic model (API `anthropic-messages`), `structured` puts the schema in the request's `output_config.format` through pi-ai's `onPayload` and reads the reply as the value, still checked, one corrective turn; any other API keeps the envelope. `packages/agent/src/caps/llm/native.ts`.
- `llm-shared-call` failover over the listed providers, an optional meter (`counted`), one time limit and a run id built from the input, from the shared file `packages/agent/src/caps/shared.ts` (export `./caps`).
- `llm-tool` `llmTool({ providers, keys, meter })`: the tool `llm_structured`, closed parameters, replay safe; the app fixes providers, keys, effort and tokens.

## How to get to it (user POV)

- A person never sees it. An app's own code calls it to read a sentence, a label or an image and then applies the result itself.

## Driving it with the example journeys

Preconditions: `npm run build`; no network and no key needed.

- **Calls.** `llm-complete-structured`, `llm-checked-answer`, `llm-limits`: `node --test test/packages/agent-caps-llm.test.mjs` (fake provider, pi-ai's faux provider, a `fetch` double).
- **Native format.** `llm-native-format`: `node --test test/packages/agent-caps-llm-native.test.mjs` (a `fetch` double behind pi-ai's real anthropic provider shows `output_config.format` in the request). Real eval shaped like chase's reader: `vault kv get -mount=secret -field=<field> agent/anthropic | node scripts/cap-real/llm-native.mjs --runs 3`.
- **Shared call.** `llm-shared-call`: `node --test test/packages/agent-caps-shared.test.mjs`.
- **Tool.** `llm-tool`: the "llm tool" tests of the same file run it through a pi-durable Harness.
- **Real model.** `vault kv get -mount=secret -field=<field> agent/anthropic | node scripts/cap-real/llm.mjs --runs 3` reads the key from standard input, sends `test/fixtures/caps/llm/sentences.json` and prints valid answers, corrective turns, median and slowest time. Without a key: `skipped: no key`.

## Gotchas

- No `process.env` and no `console` in `src/caps/`; a provider's key is read from `options.keys` under its own name (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `TYPESAFE_API_KEY`).
- Only Anthropic uses its native structured format; other APIs get the envelope (the prompt asks, the answer is checked), so an invalid answer there costs a second full call. The envelope path stays capped at 300 s by the copied Factory port, whatever `timeoutMs` says; 600 s is for the native path. No PDF part: pi-ai has images only.
- pi keeps a fixed top-level `output_config.effort` (the cached prompt) and carries the asked effort on a marker message; the native hook adds `format` beside it and changes neither.
- A tool built with a `meter` returns no `usage`, so a conversation's own meter does not count the call twice.
