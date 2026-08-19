Round 2 found that almost no agent framework ships a tenancy model - EXCEPT two, and both put it in a
paid tier: **Mastra** ("Enterprise FGA per agent/workflow/tool/memory, with route boundaries") and
**LangGraph Platform** ("custom per-resource auth and workspace RBAC"; OSS has none).

Those two are the only direct competitors to the one thing a particular product (a multi-tenant agent
platform) considers its differentiator. I need them understood in depth.

FETCH with `curl -sL --max-time 30 "https://r.jina.ai/<url>"`; use web search to find docs indexes.
Mark anything unverifiable as UNVERIFIED. Do not infer an authorization model from marketing copy -
only from documented API surface.

FOR EACH of Mastra and LangGraph Platform:
1. The exact authorization model. What are the subjects, objects, and verbs? Is it RBAC, ABAC, ReBAC/FGA
   (Zanzibar-style)? Show the actual configuration/API shape.
2. Granularity: can policy be expressed per agent? per tool? per memory/resource? per workflow node?
   Per end-user, or only per API key/project?
3. Enforcement point: where is the check made - route middleware, runtime capability, storage row filter?
   Is it re-checked per use or resolved once? Can a tool bypass it?
4. Multi-tenancy: is there a tenant/organization concept, membership, and cross-tenant isolation?
   What exactly isolates one tenant's data from another's?
5. Secrets/credentials: per-tenant credential custody? BYO keys? Rotation?
6. Human-in-the-loop interaction with auth: who is allowed to approve, and is that authorization or
   merely a gate?
7. Which tier it requires (OSS / cloud / enterprise) and what the OSS version omits.
8. Honest assessment: is this a real authorization system or a thin wrapper over API keys?

THEN a final section: "**Compared to a capability-based model**" - contrast both with an architecture
where authorization is a branded runtime capability minted per request by a trusted issuer, re-checked
on every use, and where execution grants are enforced structurally (the resource identity itself differs
per grant set, so bypass is impossible rather than merely forbidden). Which approach is stronger, where,
and what each gets wrong.

Write to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/r7-fga.md
Terse, dense, exact API shapes, cite URLs. No preamble. 500-1000 lines.
