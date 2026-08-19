Round 2 surfaced one genuinely novel mechanism worth a dedicated study:

> "Think's abort-record-replay approval protocol is novel. Model-written code is aborted at an
> unapproved action; completed tool calls are replayed from records; only the approved action is
> applied before program continuation. This turns approval into deterministic continuation of
> generated code rather than a generic 'resume the loop' signal."

Investigate this and the surrounding Cloudflare agent platform in depth.

TARGETS
1. **Project Think** (Cloudflare's first-party agent harness) - the abort-record-replay approval
   protocol above all else. How is generated code aborted mid-execution? What exactly is recorded?
   How is replay made deterministic? What happens if a replayed tool is non-deterministic? How does
   the approved action get applied? What are the failure modes?
2. **Cloudflare Agents SDK durable execution** - `runFiber()`, `startFiber()`, `stash()`,
   `onFiberRecovered()`. Round 2 says `startFiber()` durably admits named work AND deduplicates it,
   while recovery semantics are deliberately left to the agent. Get the exact API, the dedup key
   semantics, the stash contract (synchronous? size limits?), and how this differs from deterministic
   replay engines (Temporal/Restate/DBOS style).
3. **Dynamic Workflows** - runtime-loaded, tenant-selected workflow code with step progress preserved
   across isolate recycle. Exact mechanism, and the isolation/trust model for tenant-supplied code.
4. **@cloudflare/codemode + @cloudflare/shell + @cloudflare/workspace** - the code-execution and
   virtual-filesystem packages. For workspace specifically: how is a Durable Object's virtual FS kept
   in sync with a container's? That is the escalate-to-a-real-OS-only-when-needed pattern and I want
   the mechanism, not the pitch.

FETCH with `curl -sL --max-time 30 "https://r.jina.ai/<url>"`. Sources: blog.cloudflare.com,
developers.cloudflare.com/agents, github.com/cloudflare/agents, github.com/cloudflare/workspace,
and npm packages (you may `npm pack` and read dist/.d.ts). Mark UNVERIFIED where docs are silent.

FINAL SECTION: "**What a non-Cloudflare host can copy**" - for each mechanism, state plainly whether it
depends on Durable Objects/isolates or whether the idea is portable to an ordinary Node process with a
SQL store, and what the portable version would look like.

Write to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/r8-think.md
Terse, dense, code-first, cite URLs. No preamble. 500-1000 lines.
