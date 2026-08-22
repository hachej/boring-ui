# Exclusions — inject verbatim into every worker prompt

"The following are already established. Do NOT re-report them. Report only what is new, what
contradicts them, or what refines them with better evidence."

## Established mechanisms (harvested, decision made)

Flue: accepted-work durability contract (admit-before-work, one terminal outcome, at-least-once over
exactly-once recording, converge-then-classify recovery, conservative tool-batch repair); frozen system
prompt + append-only capability signals; two event surfaces (conversation vs runtime `observe()`);
persistence adapter contract with contract-tests-as-spec; opaque batch offsets; hooks/render-per-turn
authoring; data parts (`data-<name>`, in-place update); storage supplied by host with pi given an
in-memory messages array.

eve: filesystem convention (tools/ skills/ connections/ schedules/ subagents/ extensions/); durable
human-input pause (`input.requested` → `session.waiting`, stale-answer demotion, one-shot consumption);
model-hidden provided arguments; extension mount namespaces with consumer override; `defineDynamic`
(rejected — would invalidate binding digest, generation pinning, replay, catalog inspection).

opencode: bounded deterministic catalog (~2,000 est-token signature budget, chars/4), per-namespace
summaries always resident, weighted lexical `search` over omitted signatures returning full signatures,
host-resident object-tree dispatch, `execute({code})` as the single provider tool, 4,284+ line
interpreter (rejected — in-process execution of model-written code).

Managed Agents: versioned agent config snapshotted per session; separate retention clocks for
conversation vs sandbox checkpoints; `requires_action` keyed by stable tool-use id; spill oversized tool
output to a file with a bounded preview.

Cross-cutting: no framework except Mastra and LangGraph Platform ships a tenancy model, and both gate
it commercially; nobody solves prompt-injection containment, output exfiltration, shell semantics,
tool-result authorization, or confused-deputy across chained tools.

## Established about our own code

Three (four) owners of session state with a cursor fabricated as `Math.max(persisted.seq, liveSeq)`;
durable stream flag-gated off and host-wide; `mergeTools` collision machinery with no runtime caller;
`tools = [...standard, ...extra]` plain concat with pi resolving first-wins; credential vault built with
zero consumers; MCP grants gate display not execution; `AuthorizedAgentScope` brand is a `declare const
unique symbol` with no runtime value; scope verified once per connection, not per streamed event;
external plugins with `boring.server` imported into the unsandboxed host.

## Systemic pattern already named

**Mechanism built · decision ratified · never wired.** Confirmed in tool-collision policy, the credential
vault, MCP grants, D27 and #1123. Finding another instance is valuable; restating the pattern is not.
