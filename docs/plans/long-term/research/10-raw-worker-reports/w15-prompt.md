HARVEST PROMPT AND CONTEXT ENGINEERING across three reference implementations. This is the layer that
most directly determines agent QUALITY and cost per turn, and we have never compared it.

REFERENCES
A. **Flue** 2.0.3 — docs offline from /home/ubuntu/projects/spike-flue-celld:
     npx -y @flue/cli@2.0.3 docs read reference/agent-behavior | guide/models |
       reference/agent-hooks-api | guide/skills | guide/subagents
   Source: raw.githubusercontent.com/withastro/flue/main/packages/runtime/src/... or `npm pack @flue/runtime@2.0.3`
B. **eve** 0.31.3 — vercel.com/docs/eve, github.com/vercel/eve docs/ (instructions.mdx,
   agent-config.md, skills.mdx, guides/dynamic-capabilities.md). curl -sL "https://r.jina.ai/<url>"
C. **opencode** v2 — github.com/anomalyco/opencode, opencode.ai/v2/docs. Its actual prompt-building
   source is the prize: find where the system prompt is assembled.

ALREADY KNOWN — do not re-report: Flue composes the prompt at init from instructions + cwd + directory
listing + AGENTS.md + skill/subagent/tool rosters, then FREEZES it and narrates mid-window changes as
append-only signals; Flue compaction is window minus a model-aware reserve capped at 20,000 tokens with
8,000 kept verbatim; skills are progressively disclosed with one catalog line each.

DIG INTO
1. **System prompt anatomy, per framework.** What sections, in what order, and WHY that order. Quote the
   actual template/assembly code where you can find it. A side-by-side of the three is the core deliverable.
2. **Environment description.** How much of the workspace is described up front — directory listing depth,
   file counts, git status, OS/tooling? What is the size budget for it?
3. **AGENTS.md / project instruction handling.** Discovery rules (walk up? nested? per-directory?),
   size limits, precedence between global/project/local, and what happens on conflict.
4. **Tool descriptions.** How verbose, whether schemas are trimmed, whether examples are included, and
   any budget. This compounds with the catalog work we are already doing.
5. **Compaction/summarisation.** Trigger, what is kept verbatim, what the summary prompt looks like,
   whether tool results are dropped first, and whether compaction is visible in the transcript.
6. **Context-window accounting.** How each estimates tokens, what reserve they keep, and behaviour on
   overflow mid-turn.
7. **Anything about prompt caching** — what invalidates it, and whether they order the prompt to keep a
   stable prefix. Flue is explicit about this; check the others.
8. **Subagent/child context** — what a delegate inherits vs starts fresh with.

COMPARE TO OURS. We delegate most of this to pi (`@earendil-works/pi-agent-core` / `pi-coding-agent`
0.80.7, in /home/ubuntu/projects/boring-ui-v2/node_modules — follow the symlink and read the shipped
source). Establish what PI actually does for each of the eight points above, then say where the three
references are better and whether the improvement is available to us as configuration, as a pi upgrade,
or only by taking ownership of the prompt.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/w15-prompt-context.md
Side-by-side tables wherever possible, real quoted templates, real numbers. Then a ranked harvest:
change | expected effect on quality or cost | how we would do it given pi owns the prompt | risk.
Flag anything that is cheap and high-leverage — prompt changes usually are.
No preamble. 500-1000 lines.
