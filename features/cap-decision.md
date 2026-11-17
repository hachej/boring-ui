# A decision (cap-decision)

A plain import any app can call, with no Effect, no host and no framework: questions about a state (choose, score, yes or no), each answered with a confidence, by a classifier through pi-ai's `Models.classify`. The answer is a hint for the app's own rule (a threshold), never a permission.

## Sub-features

- `decision-run` `run({ state, questions }, options)` from `@hachej/boring-agent/caps/decision`: 1 to 8 questions, `choice` (criteria `{ option: meaning }`), `score` (one meaning per level) or `yes_no`, 2 to 12 options; answers `{ ok: true, answers, untrusted: true, provider, region, counted }` or `{ ok: false, kind, retryable }`, never a throw. An answer to an unasked question, of another type, outside its options or with a confidence outside [0, 1] is dropped. `packages/agent/src/caps/decision/index.ts`.
- `decision-pick` `pickOne({ state, options, threshold, timeoutMs, instructions? }, options)`: one choice; below the threshold, on a timeout or any failure it resolves `{ choice: "none", reason, code?, counted }`. No `catch` needed.
- `decision-providers` `typesafe` (Jev, `TYPESAFE_API_KEY`), `openrouter-jev` (`typesafe/jev-1.14`, `OPENROUTER_API_KEY`), `fake` (first option, middle level, no, at 0.5, unless a `fixtures` row matches; `packages/agent/src/caps/decision/fixtures.ts`). Failover, meter and time limit are the shared call's (`caps/shared.ts`).
- `decision-tool` `decisionTool(options)`: the pi-durable tool `decide`, closed parameters, replay safe.

## How to get to it (user POV)

- A person never sees it. Coach Max's food lookup keeps a sure food and marks the others « à vérifier »; Compta tags accounting lines.

## Driving it with the example journeys

Preconditions: `npm run build`; no network and no key needed.

```js
import { pickOne } from "@hachej/boring-agent/caps/decision";
const pick = await pickOne({ state: { sentence, item }, options: meanings, threshold: 0.7, timeoutMs: 700 },
  { providers: ["typesafe", "openrouter-jev"], keys: env, meter });
const food = pick.choice === "none" ? { food: hits[0], check: true } : { food: pick.choice, check: false };
```

- **Calls.** `decision-run`, `decision-pick`, `decision-providers`: `node --test test/packages/agent-caps-decision.test.mjs` (fake, scripted pi-ai classifiers, a `fetch` double behind pi's real providers).
- **Tool.** `decision-tool`: the "decision tool" tests of the same file run it through a pi-durable Harness.
- **Real classifier.** `vault kv get -mount=secret -field=<field> <path> | node scripts/cap-real/decision.mjs --runs 3 [--provider openrouter-jev]`: 20 fictional accounting lines and 10 food picks. Without a key: `skipped: no key`.

## Gotchas

- Every `classify` passes `maxRetries: 0`: the app's provider list is the retry, so a slow first provider leaves time for the next.
- `pickOne`'s `timeoutMs` is required and is the whole call (meter included); a `timeoutMs` in its options is ignored. `run` defaults to 60 s.
- No EU classifier exists in pi-ai: both real providers are `us`. Sending a person's data to one is the app's choice of list, stated per result as `region`.
- A `yes_no` goes to pi as `bool` with criteria `yes`/`no`; pi's probability above 0.5 is yes, its confidence the probability of the side chosen.
- On Workers: pi's `typesafe` provider bundles with no `node:` import (esbuild, `workerd` conditions); `openrouter` pulls the Anthropic SDK's lazy chunks, which import `node:*`, so `openrouter-jev` needs the `nodejs_compat` flag.
- With a meter, each `pickOne` takes a hold on the ledger: eight in parallel make eight holds, and a low balance turns some into `none` with a `code`.
