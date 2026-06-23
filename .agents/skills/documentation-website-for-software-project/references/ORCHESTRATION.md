# Orchestration: Multi-Agent Documentation Production‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

## Contents
- [Orchestration tiers](#orchestration-tiers) — Solo/Pair/Squad/Swarm sizing.
- [Three substrates](#three-orchestration-substrates) — subagent fan-out, NTM+Agent Mail, Beads graph.
- [Phase-by-phase orchestration](#phase-by-phase-orchestration) — what parallelizes and what doesn't.
- [Triangulation recipe](#triangulation-recipe) — multiple models on the same artifact.
- [Modes of reasoning](#modes-of-reasoning-prompt-diversification) — stance-diversified reviewers.
- [Dueling idea-wizards](#dueling-idea-wizards-phase-0--pre-phase-1) — pre-Phase-1 partition debate.
- [Repeatedly-apply-skill](#repeatedly-apply-skill-convergent-polish) — convergent polish loop.
- [Quality flywheel](#the-quality-flywheel) — compounding across projects.
- [Agent fungibility](#agent-fungibility) — provider-neutral subagent prompts.
- [CASS mining](#cass-mining-content-as-source) — corpus as reusable material.
- [Resource budgets](#resource-budgets) — token/compute envelope per tier.
- [Failure modes](#failure-modes-and-recovery).

## Overview

The skill's 10-phase pipeline is feasible solo on a tiny repo. On a real project, linear execution is the wrong default — you leave 4–8× throughput on the floor and you don't get the triangulation benefits of multiple models reading the same material independently. This file is the orchestration playbook.

Integrates with:
- [PHASES.md](PHASES.md) — the sequential description of each phase. This file describes the *concurrent* execution shape.
- [AGENT-PROMPTS.md](AGENT-PROMPTS.md) — the prompts that each subagent receives.
- [MEASUREMENT.md](MEASUREMENT.md) — the workspace artifacts each subagent emits for hand-off.

---

## Orchestration tiers

Pick a tier based on repo size, deadline pressure, and available compute:

| Tier | Repo shape | Parallelism | Runtime | When to use |
|---|---|---|---|---|
| **Solo** | <20 source files, one archetype | 1 worker (the main agent) | ~hours | Tiny lib, script-size project |
| **Pair** | 20–200 files, one archetype | 2 workers (main + 1 synthesizer) | ~hours | Typical OSS library |
| **Squad** | 200–1,000 files, 1–2 archetypes | 4–6 workers (fanned subagents) | ~half a day | Framework, SDK, CLI + library |
| **Swarm** | 1,000+ files, polyrepo / monorepo | 8–12+ workers (fanned + triangulated) | ~day | Platform, ecosystem, enterprise docs |

You can compute a tier heuristically from Phase-1 partition output: count top-level *content sections* the Partition agent will produce. ≤ 6 → Pair. 7–15 → Squad. 16+ → Swarm.

Solo exists only for unit testing the pipeline — in practice always use Pair or higher, because the independent second read is where most quality comes from.

---

## Three orchestration substrates

The skill supports three concurrent execution substrates. They compose: you pick the one that fits the coordination shape.

### 1. Subagent fan-out (default)

Straight Claude-Code `Agent(...)` tool calls. One main agent spawns N subagents in parallel via a single message with multiple tool calls. Each subagent runs its own Claude context and returns a textual report.

Strengths:
- Zero infra.
- Main agent retains authoritative context.
- Natural for map/reduce workloads (one subagent per content section).

Weaknesses:
- Subagents can't easily coordinate *between themselves* — only through the main agent.
- File-write conflicts must be prevented by partitioning (each subagent writes to non-overlapping paths).

**Use for**: Phase 3 drafting (one subagent per section), Phase 5 polish passes, independent audits.

### 2. NTM (Nested Tmux/Claude) + Agent Mail

When multi-agent coordination needs to outlive a single Claude Code session, or when agents need to work *truly* in parallel on overlapping file sets with explicit file reservations, use NTM + Agent Mail.

Key MCP tools:
- `mcp__mcp-agent-mail__register_agent` — claim an identity.
- `mcp__mcp-agent-mail__file_reservation_paths` — reserve the files you'll edit before touching them.
- `mcp__mcp-agent-mail__send_message` / `fetch_inbox` — coordinate with peer agents.
- `mcp__mcp-agent-mail__macro_start_session` — bundle: register + join product + open inbox.​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
- `mcp__mcp-agent-mail__install_precommit_guard` — wire a pre-commit check that refuses unreserved edits.

When to escalate from Tier 1 to this: Phase 5 polish when two polishers might touch the same MDX, Phase 7 Nextra-uplift when layout changes span many files, cross-agent review where a polisher wants to cite a drafter's rationale before finalizing.

### 3. Beads + `br`/`bv` task graph

[beads](https://github.com/steveyegge/beads) (`bd` CLI) builds a dependency graph of atomic tasks; `br` (ready) surfaces what's unblocked; `bv` (visualize) prints the graph. When documentation work has non-trivial dependencies (Phase 1 partition → Phase 3 drafts → Phase 4 synthesis → …), you can encode those tasks into bd and let a swarm of workers each claim the next ready task via `br --claim`.

Schema we use:

```jsonl
{"id":"doc-partition","phase":1,"deps":[],"artifact":"partition.json"}
{"id":"doc-section-install","phase":3,"deps":["doc-partition"],"artifact":"content/getting-started/install.mdx"}
{"id":"doc-section-quickstart","phase":3,"deps":["doc-partition"],"artifact":"content/getting-started/quickstart.mdx"}
{"id":"doc-synthesize-gs","phase":4,"deps":["doc-section-install","doc-section-quickstart"],"artifact":"content/getting-started/_meta.tsx"}
...
```

Then workers run a standard worker loop:

```bash
while task=$(br --claim --worker "$WORKER_ID" --tier docs); do
  phase=$(echo "$task" | jq -r .phase)
  subagent_for_phase_$phase "$task"
  bd close "$(echo "$task" | jq -r .id)"
done
```

When to use: Tier = Swarm, or Pair/Squad when the user has existing bd workflow. The graph persists through session restarts; `bv` gives a visual of completion.

---

## Phase-by-phase orchestration

### Phase 1 — Partition (solo)

The Partition agent must be a single agent — its output is the input to parallelism downstream. Never parallelize this.

**Artifact**: `workspace/partition.json` with shape `{ sections: [{slug, title, archetype_hint, source_paths, audience, diátaxis_quadrant, est_words, deps}] }`.

The `deps` edges become the dependency graph for Phase 3/4.

### Phase 2 — Research (fan-out, one per subsystem)

Spawn N research subagents (one per top-level subsystem from partition). Each emits `workspace/research/<subsystem>.md` containing: invariants, edge cases, surprise behavior, named references to file:line ranges, questions the drafter needs answered.

**Parallelism**: N = min(subsystems, 8). Parallel fan-out in a single message.

**Triangulation hook**: for high-stakes subsystems (e.g., security model, consistency model), run both a Claude-native research agent and a [Codex CLI](https://github.com/openai/codex) reviewer reading the same files independently. Compare `workspace/research/<subsystem>.claude.md` vs `workspace/research/<subsystem>.codex.md`. Surface disagreements to the synthesizer.

### Phase 3 — Draft (fan-out, one per section)

This is the biggest fan-out point. One subagent per section slug from Phase 1. Each receives:
- Its entry in `partition.json`
- Relevant research dumps
- [OPERATOR-LIBRARY.md](OPERATOR-LIBRARY.md), [CONTENT-TEMPLATES.md](CONTENT-TEMPLATES.md), [AUDIENCE.md](AUDIENCE.md)
- The target audience for this section

Each subagent writes to `content/<slug>/index.mdx` (its assigned path). Because partitioning is exclusive, there are no write conflicts.

**Parallelism**: up to 16 in swarms, clamped to avoid rate limits. Typical batch size 4–8.

**Write conflict avoidance**: each subagent owns `content/<slug>/**`. `_meta.tsx` files for each directory are owned by the synthesizer (Phase 4), not by drafters.

### Phase 4 — Synthesize (solo + coord)

The Synthesizer is a single agent. It reads every drafted file, produces cross-section `_meta.tsx` nav structure, the top-level index, the landing, and the glossary seeds. It also emits `workspace/contradictions.md` listing places where two drafts make claims that don't match.

No parallelism, but the synthesizer *delegates* contradiction resolutions back to Phase 3 drafters by opening tasks: "section X and section Y disagree on Z; you own X, please reconcile."

### Phase 5 — Polish (fan-out + triangulation)

Polish is where multi-model triangulation pays off the most. For each section:

1. **Polisher-A** (Claude): runs the full Polish Bar rubric from [OPERATOR-LIBRARY.md](OPERATOR-LIBRARY.md). Applies `⊙DE-SLOP`, `⇄CROSS-LINK`, `⊞NEXTRA-UPLIFT`, `⌘REDUCE`.
2. **Polisher-B** (optional, via Codex or Gemini): reads the *same* output from Polisher-A and runs an independent polish pass *on the draft*, not on the polished version. Emits `workspace/polish/<slug>.codex.patch` and `workspace/polish/<slug>.gemini.patch`.
3. **Merge agent**: takes both patches + the Claude polish and emits the final. Where they agree: commit. Where they disagree: surface the diff to the main agent for a call.

**Parallelism**: N polishers × M models. For a swarm, 16 × 3 = 48 concurrent passes. Rate-limit with a semaphore.​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

See [scripts/triangulate.sh](../scripts/triangulate.sh) for the invocation pattern.

### Phase 6 — Glossary (solo)

Builds the glossary from the corpus. Single agent; cross-section work. Links first-use instances of terms across all section files. See [GLOSSARY-CRAFT.md](GLOSSARY-CRAFT.md).

### Phase 7 — Nextra-ify (fan-out by page type)

Upgrade plain MDX to Nextra components (Tabs, Callout, Cards, Steps). Fan-out by *page type*: one subagent does all tutorial pages, another does all reference, another does all concept pages. This keeps component choices consistent within a type. See [ADVANCED-NEXTRA.md](ADVANCED-NEXTRA.md).

### Phase 8 — Fresh Eyes (triangulation)

Three independent "fresh eyes" reads by three different models (or three Claude agents with *different, isolated* context — none has seen the drafting). Each emits a critique. The main agent merges critiques into a punch list.

This is the most important triangulation point. A single-model fresh-eyes pass has a strong tendency to confirm its own earlier work; cross-model triangulation breaks that loop. See [AGENT-PROMPTS.md](AGENT-PROMPTS.md) §Fresh-Eyes for the prompt.

### Phase 9 — Deploy (solo)

Deploy is a single agent — coordination here just creates failure modes. See [DEPLOY.md](DEPLOY.md).

### Phase 10 — E2E & user-lens (fan-out + persona)

Fan-out one subagent per persona (see [AUDIENCE.md](AUDIENCE.md) for the 5 personas). Each spawned in an isolated context and given *only* the landing URL and the persona description. Each persona-agent simulates walking the site with that persona's goals. Emits `workspace/userlens/<persona>.md`.

---

## Triangulation recipe

When you want multiple independent perspectives on the same artifact:

1. **Isolate contexts.** Each reviewer agent MUST NOT see what the other reviewers have written. Contamination kills the signal.
2. **Same artifact, same prompt.** Give every reviewer the exact same source and the same critique prompt — variations destroy comparability.
3. **Structured output.** Each reviewer emits `{findings: [{severity, category, location, description, suggestion}]}`. Merge on `location + category`.
4. **Multi-model >> multi-instance.** Three independent Claude calls are cheaper but *correlated* — they fail the same way. Prefer Claude + Codex + Gemini when stakes are high.
5. **Adjudicate with explicit criteria.** The merging agent should apply explicit tiebreakers (e.g., "when reviewers disagree on severity, escalate" or "when 2 of 3 flag the same issue, it's real").

Codified in [scripts/triangulate.sh](../scripts/triangulate.sh).

---

## Modes of reasoning (prompt diversification)

When running multiple reviewers or polishers, diversify their *reasoning stance*, not just their model:

- **Literal reviewer** — "find claims that contradict the source." Best for accuracy bugs.
- **Skeptical reader** — "pretend you don't believe any claim; for each one, what would convince you?" Best for vague or unsupported assertions.
- **Junior reader** — "you've never used this tool before; where do you get stuck?" Best for skipped steps and assumed knowledge.
- **Expert reader** — "you know this domain deeply; where is the author papering over subtleties?" Best for half-truths.
- **Adversarial reader** — "find the least charitable interpretation that still fits the text. Could a user be misled?" Best for ambiguity.

Phase 5 polish and Phase 8 fresh-eyes should spawn *at least* three of these modes concurrently. Don't run all five — diminishing returns after three, and you start getting correlated findings.

See [AGENT-PROMPTS.md](AGENT-PROMPTS.md) §Modes-of-reasoning for exact prompts.

---

## Dueling idea-wizards (Phase 0 / pre-Phase-1)

Before Phase 1 partitions anything, spawn two separate **idea-wizard** agents with contradictory stances:

- Wizard-A: "the docs should be maximally *comprehensive* — every feature a page, every feature a tutorial."
- Wizard-B: "the docs should be maximally *focused* — cut ruthlessly, only doc the 5 things users do 80% of the time."

Let each emit a proposed outline. Main agent reads both and picks the middle path, noting tradeoffs explicitly. This avoids the "doc everything" failure mode *and* the "doc nothing important" failure mode in a single early decision.

See [AGENT-PROMPTS.md](AGENT-PROMPTS.md) §Dueling-wizards.

---

## Repeatedly-apply-skill (convergent polish)

For Phase 5, apply the polish skill *repeatedly* to the same artifact with fresh eyes each pass until no further improvements are found:

```
while improvements_found:
  spawn polisher with ISOLATED context
  feed current doc + OPERATOR-LIBRARY.md
  measure delta (diff size, lint score, heading count)​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
  if delta < threshold: break
  commit polish; increment pass_number
```

Typically converges in 2–3 passes on quality docs. If it hasn't converged in 5, there's a structural problem (audience-level mismatch, wrong Diátaxis quadrant, missing research) that polish can't fix — escalate back to Phase 3.

Capped at 5 passes to avoid infinite polish spirals.

---

## The quality flywheel

Documentation produced this way compounds:

1. **Phase 10 user-lens outputs** surface real confusion → recorded as FAQ sources ([GLOSSARY-CRAFT.md](GLOSSARY-CRAFT.md) §FAQ).
2. **FAQ entries** get promoted to concept pages when their click-through is high ([FEEDBACK-PIPELINE.md](FEEDBACK-PIPELINE.md)).
3. **Promoted pages** get new user-lens reviews → more confusion surfaced → more FAQ.
4. **Drafting corpus grows** → Phase 3 in the *next* project uses prior polished docs as style anchors, not as training data.

The flywheel is what makes this skill accretive across projects in the user's portfolio.

---

## Agent fungibility

Where practical, write subagent prompts such that *any* competent general-purpose model can fulfill them. Benefits:

- When one model provider has a bad hour, fail over to another.
- Cheaper models handle straightforward synthesis; expensive models handle contradiction resolution and adjudication.
- Three independent reads from three providers is the strongest triangulation.

Avoid provider-specific artifacts in subagent output (no `<thinking>` tags, no `<*>` markup, no model-specific hedging patterns). See [subagents/](../subagents/) for prompts designed to be fungible.

---

## CASS mining (content as source)

Once a project has polished docs, treat the *corpus itself* as mineable:

- **Exemplar extraction** for future projects: `scripts/corpus-export.mjs` can export polished sections as exemplar JSON → feeds [EXEMPLARS.md](EXEMPLARS.md) for the next project.
- **Kernel extraction**: for the `operationalizing-expertise` skill (Track A), export decisions and invariants from the concept pages as "quote-bank" and "kernel" entries.
- **Voice calibration**: measure linguistic features (sentence length, vocabulary density, hedging rate) and use them as style anchors for the next project.

See [CORPUS-EXPORT.md](CORPUS-EXPORT.md) for the export schema.

---

## Resource budgets

Rough compute/token budgets by tier:

| Tier | Phase-3 parallelism | Polish triangulation | Total token budget |
|---|---|---|---|
| Solo | 1 | 1 model | 100–300k |
| Pair | 2 | 1 model | 300k–1M |
| Squad | 4–6 | 2 models | 1–3M |
| Swarm | 8–12 | 3 models | 3–10M |

These are targets, not limits. Phase 10 user-lens adds ~5 personas × ~20k = 100k regardless of tier. Triangulation multiplies Phase 5 and Phase 8 token use by N_models.

The skill never silently exceeds a budget — if Phase 3 fan-out would exceed the user's stated budget, the main agent narrows the fan-out and notes the reduction in `workspace/phase_metrics.json`.

---

## Failure modes and recovery

- **Subagent timeout / dropped output**: the main agent re-spawns with the same prompt. Artifacts are idempotent.
- **Contradictions the synthesizer can't resolve**: escalate to the main agent, which asks the user. Record decision in `workspace/adr/`.
- **Phase 3 fan-out exceeds budget**: serialize; emit `workspace/notes/serial-draft.md` explaining why.
- **One model provider down during triangulation**: drop to 2-model triangulation; note in `workspace/phase_metrics.json` that triangulation was degraded for this run.
- **Beads worker stuck on a task**: `bd reset <task>`; another worker claims.
- **Agent Mail reservation held by dead worker**: `force_release_file_reservation` after confirming worker is gone.

---

## See also

- [PHASES.md](PHASES.md) — sequential per-phase description.
- [AGENT-PROMPTS.md](AGENT-PROMPTS.md) — exact prompts this orchestration invokes.
- [MEASUREMENT.md](MEASUREMENT.md) — workspace artifact layout.
- [TESTING-DOCS.md](TESTING-DOCS.md) — validation strategy for orchestrated output.
