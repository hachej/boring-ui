You are producing a complete technical analysis of **Anthropic's Managed Agents** (server-hosted
agents with a managed sandbox, part of the Claude Developer Platform / Claude API), plus the
**Claude Agent SDK** where the two overlap.

TOOLING: fetch docs with
    curl -sL --max-time 30 "https://r.jina.ai/<FULL_URL>"
which returns clean markdown. Start from https://docs.anthropic.com/ and
https://docs.claude.com/ - find the Managed Agents section, the Agent SDK section, and the
Messages API tool-use docs. Walk the index, then fetch every relevant page.
Do NOT invent API shapes. If something cannot be verified from the docs, write "UNVERIFIED".

REPORT ON, in this order:
1. What Managed Agents actually is: the hosting model, who runs the loop, what the request/response
   surface looks like, and how it differs from running the Agent SDK yourself.
2. Agent definition: system prompt, model selection, configuration surface, versioning.
3. Sessions/conversations: identity, persistence, resume semantics, retention, limits.
4. Durability: what happens on interruption. Is there a submission/settlement concept? Retries?
   Idempotency? Be precise; if the docs are silent, say so explicitly.
5. The managed sandbox: what isolation, what filesystem, what network egress policy, what is
   preinstalled, lifecycle and timeouts, whether state persists between turns.
6. Tools: built-in tools (bash, file editing, computer use, web search, code execution...), custom
   tool definition, tool-use wire format, parallel calls, error handling.
7. MCP: outbound MCP connector support, authentication, and any inbound/server-side story.
8. Skills / Agent Skills: format, discovery, the agentskills.io relationship, progressive disclosure.
9. Subagents / multi-agent: any first-class delegation primitive.
10. Streaming: the wire protocol, event types, resume-after-disconnect story.
11. Observability: usage reporting, tracing, logging surfaces.
12. Auth/tenancy: API keys, workspaces, per-key scoping, spend controls, admin API.
13. Pricing/limits that shape architecture: context window, rate limits, sandbox time, storage.
14. Prompt caching semantics as they apply to a long agent turn (what invalidates the cache).

OUTPUT: write to
/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/r3-managed-agents.md

End with two sections:
- "Mechanisms worth copying" - 10 items, one sentence each, most valuable first.
- "What it does NOT give you" - what a team building a multi-tenant agent product would still have
  to build themselves.

Be terse and factual, dense bullets and tables, exact API shapes and numbers, cite the doc URL for
each claim. No preamble. Target 700-1400 lines.
