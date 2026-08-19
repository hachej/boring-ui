ADVERSARIAL REVIEW of a set of prompt-engineering recommendations, PLUS a deeper dive to strengthen the
ones that survive. Two jobs: break the weak ones, harden the strong ones with specifics.

THE RECOMMENDATIONS: research/w15-prompt-context.md, "Ranked harvest" (12 items). The top ones:
  1. Replace pi's default system prompt with a Boring-specific `customPrompt` via `createAgentSession`
     ("removes irrelevant PI docs", claimed VERY HIGH cost reduction, risk "must preserve essential
     coding/tool rules")
  2. Stop duplicating tool descriptions; require a <=80-char `promptSnippet`
  4. Nested instruction resolution by target file (closest AGENTS.md wins)
  6. Move volatile dynamic material out of the fixed prefix (cache hit rate)
  8. OpenCode-style pruning of old tool output before lossy summarisation
  12. Remove the date from the stable prompt

PART 1 — ATTACK
- For #1: what EXACTLY is in pi's default prompt that we would drop? Enumerate its sections from the
  installed source (/home/ubuntu/projects/boring-ui-v2/node_modules/@mariozechner/pi-coding-agent,
  follow the symlink). Which parts are load-bearing for tool-calling correctness, edit-tool discipline,
  or refusal behaviour? Quantify the claimed saving with real numbers, not adjectives. What regressions
  would a naive replacement cause, and how would we detect them? Does our eval suite
  (packages/agent/src/eval/**) even cover this?
- For #2: is `promptSnippet` a real pi/provider concept or an invention? If tool descriptions are what
  the model uses to choose correctly, is an 80-char cap a quality regression dressed as a saving?
- For #8: what evidence is there that pruning old tool output is safe? Name the cases where pruned tool
  evidence changes the answer.
- For #6 and #12: verify the caching claim against the ACTUAL provider behaviour for the models we use
  (google/gemini and anthropic). What genuinely invalidates a cached prefix for each? If our default
  model does not support prefix caching at all, #6 and #12 are worth nothing — CHECK.
- Any recommendation that is unfalsifiable as written.

PART 2 — GO DEEPER AND STRENGTHEN
For every recommendation that survives, make it concrete enough to implement:
- the exact seam (function, option, file) in our code or pi's
- the measurement that proves it worked, and the baseline to compare against
- the eval/test that guards the regression it risks
Then dig for what the harvest MISSED. Read the three reference implementations' prompt assembly again
with fresh eyes — Flue (offline: cd /home/ubuntu/projects/spike-flue-celld && npx -y @flue/cli@2.0.3
docs read reference/agent-behavior), eve (vercel.com/docs/eve instructions/agent-config via
curl -sL "https://r.jina.ai/<url>"), opencode (github.com/anomalyco/opencode prompt assembly source) —
and look specifically at: system-reminder style injections, how each handles tool RESULTS in context
(truncation, references, spill-to-file), stop conditions and turn limits, and how each phrases tool
descriptions (imperative vs descriptive, examples vs none). Those are the parts a first pass skips.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/a3-prompt-review.md
Part 1: recommendation | verdict (SOUND / WEAK / WRONG / UNFALSIFIABLE) | evidence | what to do instead.
Part 2: the surviving set, implementation-ready, plus new findings the first pass missed.
Real numbers throughout. No preamble. 500-900 lines.
