ADVERSARIAL REVIEW of a design that has just been filed as a GitHub epic and will be implemented.
Your job is to BREAK IT before anyone builds it. Concrete failure scenarios beat concerns.

THE DESIGN: issue #1226 in /home/ubuntu/projects/boring-ui-v2 — read it with `gh issue view 1226`.
Summary: separate authorization (grants) from residency (token budget). Three tiers — always-resident
core tools, budgeted full signatures, summary + searchable. Two tools: `search_tools({query})` returning
full signatures, and `call_tool({name,args})` dispatching to an already-installed host-side tool.
Grants enforced twice: before catalog construction and again at dispatch. Canonical id kept separate
from model-facing name. Catalog identity folds into the binding digest.

CONTEXT (read-only, `git show origin/main:<path>`):
  packages/agent/src/server/agent-host/buildAgentComposition.ts   (tools = plain concat, line ~181)
  packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts
  packages/agent/src/server/agent-host/mcpGrants.ts
  packages/agent/src/server/catalog/mergeTools.ts
  packages/agent/src/front/toolRenderers.tsx  packages/agent/src/shared/tool-ui.ts
  packages/agent/src/shared/chat/piChatEvent.ts   (tool-call/tool-result events)
  docs/DECISIONS.md  (D28, D29 — binding identity, scope discipline)
Reference implementation already studied: research/w13-opencode.md.
pi resolves tools with `tools.find(t => t.name === call.name)` — FIRST match wins.

ATTACK
1. **Does `call_tool` actually preserve renderer identity?** Trace it concretely: model calls
   `call_tool({name:'mcp__linear__create_issue'})` -> what tool-call/tool-result events are emitted, with
   what `name`? Does `toolRenderers` key off something that still exists? If the renderer sees
   `call_tool` rather than the inner tool, the epic's central premise fails. Quote the event shapes.
2. **Nested/child call visibility.** Is the inner call a first-class event or swallowed inside the outer
   tool's result? What breaks in the UI, in metering, and in approval flows?
3. **Approval interaction.** #900 requires ONE exact Ask User approval bound to canonical arguments per
   call. Through `call_tool`, what exactly is approved — the outer call or the inner one? Construct the
   bypass if there is one.
4. **The double grant check.** Is checking at catalog construction AND dispatch actually sufficient, or
   is there a window between them (grant revoked mid-session, catalog cached across turns, binding
   reused)? Name the interleaving.
5. **Retrieval failure modes.** Model searches badly, or never searches because the summary tier reads
   as complete. Model calls a tool it saw in an earlier turn's search but which is no longer granted.
   Model passes a name that is a prefix/near-miss. What happens in each?
6. **Budget accounting.** Who counts tokens, when, and against which model's tokenizer? What happens
   when the budget is smaller than a single tool's signature? When core tools alone exceed it?
7. **Binding digest.** If catalog identity folds into the digest, how many distinct bindings does a
   workspace with per-user grants produce? Is this the cache-cardinality explosion the capability
   analysis warned about (see research/r7-fga.md)?
8. **Does this actually save anything?** The budgeted tier still holds full signatures. If the model
   searches on most turns, the search results re-enter context anyway. Model the token cost across a
   realistic 20-turn session and say whether the saving survives.
9. Anything else that would be discovered painfully at implementation time.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/a1-epic-review.md
Per finding: severity (FATAL / SERIOUS / MINOR), the failing scenario, and a concrete fix or a statement
that the design must change shape. End with a blunt verdict: is #1226 ready to plan against, or does it
need rework first? Do not be diplomatic.
No preamble. 400-800 lines.
