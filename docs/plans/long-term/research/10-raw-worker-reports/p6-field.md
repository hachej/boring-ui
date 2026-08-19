You are surveying the REST of the TypeScript/production agent-framework field. Three frameworks have
already been analysed in depth (Flue, Vercel eve, Anthropic Managed Agents) - do NOT cover those.

COVER, in this priority order:
1. **OpenAI Agents SDK** (openai-agents-js / AgentKit) - the TypeScript one, plus the Responses API
   agent surface and any hosted/managed agent offering.
2. **Cloudflare Agents SDK** (`agents` npm package, developers.cloudflare.com/agents) - the platform
   layer beneath Flue: Agent class, fibers (runFiber/stash/onFiberRecovered), @cloudflare/shell,
   @cloudflare/codemode, @cloudflare/workspace, dynamic workflows. Also **Project Think**, their
   first-party harness, if documented.
3. **Mastra** (mastra.ai) - TypeScript agent framework.
4. **LangGraph / LangGraph Platform** (JS) - focus on the durability and human-in-the-loop model,
   which is its distinctive contribution.
5. **Inngest AgentKit** and any other durable-execution-first agent framework you find.
6. **OpenClaw** (openclaw.ai) - reportedly built on the pi harness; worth a short section.

FETCH with `curl -sL --max-time 30 "https://r.jina.ai/<url>"`. Use web search if a docs index is hard
to find. Do not invent APIs; mark anything unverified as UNVERIFIED.

FOR EACH framework answer the SAME five questions, so the results are comparable:
  Q1 AUTHORING - how is an agent declared? (code / config / filesystem / graph) Show the minimal example.
  Q2 DURABILITY - is there a durable-execution contract? Exact semantics: admission, retries,
     settlement, idempotency, what survives a crash. If absent, say ABSENT.
  Q3 TENANCY - is there ANY multi-tenant / membership / per-agent authorization model? Be specific.
     (Three frameworks so far have all answered "no" - I want to know if that is universal.)
  Q4 HUMAN-IN-THE-LOOP - is an approval/question a durable pause or a blocked process?
  Q5 SANDBOX/EXEC - what isolation, if any, and is the contract pluggable?

Then a comparison table across all frameworks you covered, one row each, columns Q1-Q5.

FINAL SECTION: "**Mechanisms not yet seen elsewhere**" - only list things that are genuinely NOVEL
relative to Flue/eve/Managed Agents, which I have already analysed. If a framework offers nothing
novel, say so in one line and move on. I care about new ideas, not coverage.

Write to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/r6-field.md
Terse, factual, dense tables, cite URLs. No preamble. 600-1200 lines.
