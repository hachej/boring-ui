A HANDS-ON DEVELOPER-EXPERIENCE STUDY. Do not write an opinion piece. Actually perform the onboarding
for each system, time it, count the steps, and record every place you got stuck. Then do the same for
ours and compare like for like.

WORKSPACE: ~/projects/spike-dx (scratch; make a subdirectory per system)
Model key when needed: export VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$(cat ~/.vault-token);
export GEMINI_API_KEY=$(vault kv get -field=api_key secret/agent/gemini); GOOGLE_API_KEY=$GEMINI_API_KEY
(Anthropic key has NO credits.) Node here is v22 — eve requires >=24, so eve is READ-ONLY: scaffold what
you can, read its templates and docs, and mark anything you could not execute as NOT-RUN.

TASK PER SYSTEM — the same task each time, so the comparison is fair:
  "A developer wants an agent that answers questions about a codebase, has one custom tool, and one
   skill, running locally, then reachable over HTTP."

A. **Flue** — you have it working already at /home/ubuntu/projects/spike-flue-celld; start FRESH in a new
   dir to time honest onboarding. `npx @flue/cli init`, add a tool, add a skill, `flue run`, then serve.
B. **eve** — `npm pack eve@0.31.3` / read templates + docs. Reconstruct the same task on paper from its
   filesystem convention. Mark NOT-RUN.
C. **boring-ui (ours)** — the equivalent path. Start from /home/ubuntu/projects/boring-ui-v2 docs:
   AGENTS.md, docs/README.md, packages/workspace/docs/PLUGIN_SYSTEM.md and PLUGIN_STRUCTURE.md,
   packages/agent/docs/**, .agents/skills/boring-app-setup and boring-plugin-build.
   Do NOT modify that repo — build in ~/projects/spike-dx/boring and consume the packages.

RECORD, PER SYSTEM
1. **Time to first agent reply** (wall clock, honestly measured) and **number of discrete steps**.
2. **Files a developer must create or edit**, and total lines they must write for the task above.
3. **Concepts they must learn before step 1** — count them. Name every term that appears in the required
   docs without being defined there.
4. **Every error encountered**, verbatim, and whether the message told you how to fix it. Grade each
   message: ACTIONABLE / VAGUE / MISLEADING. Error quality is the single biggest DX differentiator and
   is usually invisible in docs.
5. **What worked with zero configuration** vs what demanded a decision before anything ran.
6. **The moment of first feedback** — how long before the developer sees ANY sign it works.
7. **Docs**: is there a single canonical path from zero to running? Any dead ends, stale commands, or
   contradictions between pages? Are the docs written for a human or for a coding agent (Flue and eve
   both do the latter deliberately — assess whether that helps or hurts a human).

THEN
8. **Side-by-side table** of 1-6 across the three.
9. **Specific, concrete changes to OUR developer experience**, ranked by (developer minutes saved) /
   (effort to build). For each: exactly what a developer does today, exactly what they would do after,
   and where the change lives in our repo. Prefer removing a decision over adding a feature.
10. Where OUR DX is already BETTER, say so — we should not regress it while copying.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/w17-dx-study.md
Real timings, real error text, real line counts. Anything you did not actually run must be labelled
NOT-RUN. An honest "ours took 40 minutes and theirs took 4" is the most useful sentence you can write.
No preamble.
