EXECUTABLE SPIKE that settles the central premise of GitHub issue #1226. An adversarial review is
reasoning about it; you must SETTLE it by running code.

THE PREMISE UNDER TEST
"`call_tool({name, args})` dispatching to an already-installed host-side tool preserves TOOL IDENTITY,
so tool-call/tool-result events keep their real names and our per-tool renderers keep working."
If false, #1226 must change shape before anyone plans against it.

WORKSPACE: ~/projects/spike-tool-catalog (empty; scaffold it — Node 22, vitest).
REFERENCE RIG that already works: ~/projects/spike-pi-storage proves pi runs with host-supplied
`SessionStorage` on the pinned `@earendil-works/pi-agent-core@0.80.7`. Copy that pattern.
Model: gemini. `export VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$(cat ~/.vault-token);
export GEMINI_API_KEY=$(vault kv get -field=api_key secret/agent/gemini); export GOOGLE_API_KEY=$GEMINI_API_KEY`
(the Anthropic key has NO credits). Vault IS reachable — if your sandbox blocks it, say so explicitly
and prove the non-model half offline rather than fabricating output.

BUILD AND OBSERVE
1. Register three ordinary pi tools with distinct names (e.g. `alpha_ping`, `beta_add`, `gamma_echo`).
   Run a turn that calls one directly. **Capture the exact event stream pi emits** — tool-call and
   tool-result, with every field. Paste it. This is the control.
2. Now add a `call_tool({name, args})` dispatcher tool that looks the target up in a host-side map and
   invokes it. Run a turn where the model reaches `beta_add` THROUGH `call_tool`.
   **Capture the event stream again and diff it against the control.** Specifically:
     - what `name` appears on the tool-call event?
     - is there any event carrying `beta_add`, or only `call_tool`?
     - where does the inner result appear — as its own event, or nested inside the outer result?
3. Add `search_tools({query})` over a catalog of ~40 synthetic tool signatures. Prove the model can find
   a tool it was NOT shown resident and then call it via `call_tool`.
4. **Measure the token cost** three ways for the same 40-tool set: (a) all 40 resident as normal tools,
   (b) catalog+search with a ~2,000-token budget, (c) summary-only. Report real serialized sizes as sent
   to the provider — not char/4 estimates if you can obtain the actual request payload.
5. Run a multi-turn session (>=8 turns) where the model searches repeatedly, and report whether the
   saving survives repeated search results re-entering context.

THE DELIVERABLE THAT MATTERS
A clear statement, backed by pasted event JSON: does dispatch through `call_tool` preserve the inner
tool's identity in the event stream, or not? If NOT, state exactly what a nested-child-call event would
have to carry for renderers, metering and per-call approval to keep working.

REPORT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/s6-catalog-report.md
Pasted event streams, real token numbers, and a blunt verdict on #1226's premise.
No preamble.
