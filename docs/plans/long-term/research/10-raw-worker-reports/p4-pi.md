You are auditing **pi** (pi.dev, packages `@earendil-works/pi-agent-core`, `pi-ai`, `pi-coding-agent`,
also published as `@mariozechner/pi-coding-agent`). A production TypeScript codebase (boring-ui) depends
on `pi-coding-agent@0.80.7` and has, over time, built its OWN implementations of session storage,
event streaming, replay, tool assembly, skills discovery, MCP wiring and compaction on top of it.

THE QUESTION I NEED ANSWERED: **what does pi already provide natively that a consumer would be foolish
to reimplement?** Every capability pi ships that a host has rebuilt is deletable code. That is the goal
of this report - find the overlap.

SOURCES (use all three):
1. Docs: fetch with `curl -sL --max-time 30 "https://r.jina.ai/https://pi.dev/docs/latest/..."`.
   Walk the docs index first. Cover at least: providers, usage, sessions, tools, skills, MCP,
   compaction/context, extensions/plugins, and any persistence or events pages.
2. Installed source, ALREADY ON DISK - read it directly, this is the authoritative surface:
   /home/ubuntu/projects/boring-ui-v2/node_modules/@mariozechner/pi-coding-agent
   (a symlink into .pnpm; follow it). Read its package.json `exports`, its .d.ts files, and dist.
   Also look for `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` in the same store:
   ls /home/ubuntu/projects/boring-ui-v2/node_modules/.pnpm | grep -i earendil
3. `npm view @earendil-works/pi-agent-core` / `pi-ai` / `pi-coding-agent` for version + exports.

REPORT:
1. **Package split.** What lives in pi-agent-core vs pi-ai vs pi-coding-agent. Which are
   runtime-portable (no node:child_process / worker_threads / native deps) and which are not.
   List the exact node builtins each uses. This decides what could ever run in a constrained runtime.
2. **The complete public API surface** of each package: exported types and functions, grouped by
   capability. Signatures, not prose.
3. **Session/persistence:** what pi natively stores, where, in what format; the load/save/resume API;
   whether an external consumer can supply its own store or must use pi's.
4. **Events:** what pi emits during a turn, the exact event/callback surface, whether it is
   subscribable, and whether it carries enough to rebuild a UI transcript.
5. **Tools:** how tools are defined and registered, the built-in tool set, tool result shapes,
   cancellation, and any progress/streaming facility.
6. **Skills:** discovery (cwd/agentDir/package resolution), SKILL.md parsing, progressive disclosure,
   activation mechanics.
7. **MCP:** what pi does natively for MCP clients; config surface; tool namespacing.
8. **Context/compaction:** pi's native compaction, its configuration surface and defaults.
9. **Extensions/plugins:** the plugin model, how third-party code is loaded (jiti?), the trust model.
10. **Steering / follow-up queue:** pi's native handling of messages that arrive mid-turn.

FINAL SECTION - the one that matters most:
"**Reimplementation candidates**" - a table of: pi capability | where a host would typically rebuild it |
whether pi's version is sufficient | what would have to be true to delete the host's version.
Be specific and honest; where pi's version is genuinely inadequate for a multi-tenant host, say so
and say why.

Write to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/r4-pi.md
Terse, factual, dense tables, exact signatures. No preamble. 700-1400 lines.
