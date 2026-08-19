You are producing a complete technical analysis of **eve**, Vercel's open-source agent framework
(launched 2026-06-17, npm package `eve`, currently 0.31.3, site https://eve.dev,
docs https://vercel.com/docs/eve, blog https://vercel.com/blog/introducing-eve).

TOOLING: this machine has network access but many sites are Cloudflare-protected. Fetch docs with:
    curl -sL --max-time 30 "https://r.jina.ai/<FULL_URL>"
which returns clean markdown. Walk the docs index first, then fetch every page. You can also inspect
the package without running it:
    npm view eve  /  npm pack eve@0.31.3 && tar xf eve-*.tgz   (node >=24 is required to RUN it; you
    only need to READ it, so unpack and read the dist/types/docs instead)
Do not guess or fill gaps from general knowledge of other frameworks. If a fact cannot be verified,
write "UNVERIFIED" next to it.

REPORT ON, in this order:
1. The filesystem convention in full: every directory that has meaning (tools/, skills/,
   connections/, schedules/, ...), what a file in each must export, and the naming rules.
   This is the single most important section - be exhaustive.
2. Agent definition: how an agent is declared, its config surface, instructions/model selection.
3. Tools: signature, schema validation library, error handling, streaming/progress, cancellation.
4. Skills: format, are they agentskills.io compatible, progressive disclosure, supporting files.
5. MCP: outbound connections (connections/), any inbound/server support, authentication model.
6. Durability: exact contract. What survives a crash. Submissions/attempts/retries/settlement
   semantics. Where state is stored. Is there a persistence adapter contract?
7. Sandboxing: "isolated VMs by default" - what provider, what isolation boundary, filesystem
   semantics, exec, network policy, lifecycle/teardown, cost model.
8. Human-in-the-loop approvals: the exact mechanism (this is called out as a headline feature).
9. Subagents: declaration, context isolation, parallelism, durability of child work.
10. Channels: which providers, how inbound events map to sessions, verification, outbound replies.
11. Schedules: cron model, delivery semantics, missed-fire/overlap behaviour.
12. Evals/testing: the built-in testing tool, what it asserts, how it runs.
13. Deployment & runtime: where agents run, Vercel-hosted vs self-host, "run anywhere" claim -
    what is actually portable, what is Vercel-only.
14. Observability: event stream, telemetry, exporters.
15. HTTP/wire surface: routes, streaming protocol, cursors/resume, SDK client.
16. Auth/tenancy: is there ANY multi-tenant, membership or per-agent authorization model? Be
    specific - this is the question I care most about.

OUTPUT: write to
/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/r2-eve.md

End with two sections:
- "Mechanisms worth copying" - 10 items, one sentence each, most valuable first.
- "Where eve is weak" - honest list of what it does not do or does badly.

Be terse and factual, dense bullets and tables, exact signatures and numbers, cite the doc URL for
each claim. No preamble. Target 700-1400 lines.
