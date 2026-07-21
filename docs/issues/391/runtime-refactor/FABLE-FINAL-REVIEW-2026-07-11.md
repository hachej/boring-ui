> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# Fable Final Review — Vision, Plan Upgrades, Operating Doctrine

Written 2026-07-11 by the Fable orchestrator session on its last day of access.
Everything here was decided or observed in-context during the 2026-07-11 planning
cycle (#625, #631, #632, #640, #642, issue #636). Owner: Julien.

---

## Part 1 — Product vision feedback (honest)

### What is genuinely strong

1. **The abstraction discipline is rare and real.** "MCP consumers are regular
   users", "one consumption contract, protocol bindings at the edges",
   "contracted mode is a layered decorator, never a fork" — these three rules
   mean every future surface (marketplace, channels, A2A, API/CLI) is an
   adapter, not a redesign. The marketplace grill proved it: the entire
   creator/coach scenario added ZERO architecture — only three product
   workpackages. When a vision stress-test produces no architectural delta,
   the abstraction is right. Guard these rules; they are the plan's spine.

2. **The workspace-as-vault is the actual moat candidate.** Not the agents,
   not the protocol doors. A consumer's workspace accumulates their context
   (the fitness journal effect); a contractor's workspace compounds expertise
   across engagements. That is data gravity per *user*, independent of which
   model is fashionable. The strategic frame: boring-ui is becoming a **system
   of record for agentic work**. Every roadmap decision should be tested
   against "does this deepen the vault?"

3. **EU sovereignty is a wedge, not a constraint.** For European mid-market
   B2B, "your agents, your data, EU-hosted, no US dependency" is a
   procurement-friendly differentiator the US platforms structurally cannot
   match. Lead sales conversations with it.

4. **B2B-now / marketplace-later with marketplace-ready fundamentals** is the
   correct sequencing, and it was formalized (MARKETPLACE-PATH.md owner
   ruling). The discipline to keep BL1/MK1/CH1 unstaffed until demand is what
   makes the breadth survivable.

### Honest risks and blind spots

1. **Solo capacity vs platform surface.** The pack now spans runtime, identity,
   billing, channels, marketplace, sandbox, and two protocols. Phasing helps;
   it does not remove the carrying cost of breadth (every frozen WP still
   costs attention at every replan). Mitigation: anchor each phase to ONE
   lighthouse client whose real deployment forces priority. Do not open a
   phase without a named consumer of its output.

2. **The demo is not the product.** MCP plumbing demos impress engineers;
   buyers buy a working agent for THEIR workflow. The single most
   commercially load-bearing number in the pack is the **golden path: idea →
   deployed agent in ≤ 15 minutes** — and it is still unmeasured. Pull that
   measurement forward (it is one P8 bead); it is your sales weapon, your
   internal health metric, and your regression alarm in one.

3. **Marketplace cold-start is creator-led, not catalog-led.** The fitness
   scenario works because the influencer brings their audience. Consequence:
   when the marketplace day comes, CH1 (WhatsApp/Telegram, where the audience
   lives) matters MORE than MK1 (catalog browsing). Discovery will come from
   the creator's channel, not from search. Sequence accordingly; a catalog
   with no audience is a ghost town.

4. **Platform risk at the doors.** OpenAI/Anthropic own the stock-client UX
   and are moving up-stack (app stores, connector directories, hosted agents).
   The doors (MCP today, A2A tomorrow) are commodity and controlled by others.
   The defensible layers are: the vault (data), governance (policy/audit),
   EU hosting, and model-neutrality. Invest tokens there; treat doors as thin
   adapters forever.

5. **Trust is the contracted-agent bottleneck.** For B2B-now, you personally
   are the QA on every hosted agent — fine. The moment third parties contract
   agents you did not author, quality and the recorded contractor-data-hygiene
   known-unknown become the product. A reputation/review primitive will be
   needed before open marketplace; it is deliberately absent today — keep it
   that way until phase 4, but know it is the phase-4 hard part, not billing.

6. **Missing: phase exit metrics.** Phases have shippable outcomes but no
   numbers. Proposed (adopt or adjust):
   - Phase 2 (factory v1): 3 distinct agents live on one Docker host for ≥ 1
     real client; new-agent time ≤ 1 day; golden path measured.
   - Phase 3 (external consumption): 1 external user completes a task via
     their own MCP client unassisted; artifact link redeemed; zero
     cross-workspace incidents.
   - Phase 4 (marketplace mechanics): first invoice generated and paid for a
     contracted engagement.
   - Phase 5 (reach): first consumer conversation completed entirely over
     Telegram.

7. **Missing: a B2B price placeholder.** The commercial default was rightly
   deferred, but outreach needs a number tomorrow. Suggested placeholder
   consistent with the architecture: **setup fee per agent (authoring) +
   monthly per hosted agent-workspace (managed retainer), metered LLM cost
   passed through** — dedicated-VM variant priced as infrastructure premium.
   This prices the vault and the operations, not the tokens, and is fully
   reversible later.

---

## Part 2 — Plan upgrades (details the pack is missing)

These extend, and never override, the merged pack (post-#640). Single-writer
courtesy: this file is additive; the codex root session remains the pack's
writer of record for INDEX/PR-PLAN.

### ID1 — implementation guidance
- **Do not hand-roll OAuth.** Evaluate EU-self-hostable identity servers
  first: Ory Hydra (lightweight, API-first) or Keycloak (batteries included).
  Selection bead: 0.5 day, criteria = OAuth 2.1 + PKCE, Resource Indicators
  (RFC 8707), Protected Resource Metadata (RFC 9728), CIMD or DCR support,
  container footprint on the D1 host.
- Auto-provisioning hook: on first successful token exchange, create account +
  personal workspace; idempotent by subject claim.
- The API-key surface (HTTP API/CLI bindings) issues keys from the same
  identity store; keys map to the same principal + workspace model.

### AR1 v1 — four beads (post-#640 lane split)
1. Share-entry store: `{id, workspaceId, path, provenance(agent, task, ts)}`.
2. Deep-link route `/a/<id>`: membership auth → workspace UI focused on path;
   tombstone renderer (provenance + last-known metadata) when missing.
3. MCP resource exposing the same entry for machine consumers.
4. Cross-workspace deliverable lane: implement `ArtifactTransferHandle` per
   the #640 spec ONLY when the first contracted-mode engagement exists.

### AC1 — contract type sketch (mirror A2A v1.0; keep in contracts layer)
```ts
type TaskState = 'submitted' | 'working' | 'input-required'
               | 'completed' | 'failed' | 'canceled' | 'rejected';
interface AgentTask {
  id: string; contextId: string;           // conversation grouping
  state: TaskState;
  messages: AgentMessage[];                // ordered
  artifacts: ArtifactRef[];                // outputs
  principal: PrincipalRef;                 // originating user+workspace
  actor?: AgentRef;                        // acting agent (audit)
}
interface AgentMessage { role: 'consumer'|'agent'; parts: Part[]; ts: string }
type Part = { kind: 'text'; text: string }
          | { kind: 'file'; ref: ArtifactRef }
          | { kind: 'data'; mime: string; data: unknown };
```
Guards from Decision 22 spec items: depth/cycle limit (recommend max depth 3,
same-pair cycle refusal), input-required timeout (recommend 24h → canceled
with resumable context), schema version field from day one.

### D1 — first slice, concretely
- One compose file: core app + identity server + N agent bundles resolved by
  P6-R; per-workspace env/secrets via the P5a narrow pattern only as needed.
- Hostname → landing-site mapping per Decision 23 (hostname grants nothing).
- Acceptance: 3 distinct agents on 1 EU host, each bound to its workspace,
  golden-path timing recorded. That IS phase-2 exit.

### Risk register (consolidated tripwires)
| Risk | Tripwire |
|---|---|
| Unbounded spend (open signup + operator keys) | BEFORE ID1 public exposure: per-workspace budgets ship first |
| Contractor data hygiene across customers | BEFORE third-party contracting opens |
| X1 thresholds from flawed benchmark | BEFORE any mount-dependent commitment: rerun x1-bench |
| runsc EU parity unproven | BEFORE D1 provider lock: 1-day validation spike (#628 preflight is the seam) |
| Reputation/QA for foreign agents | BEFORE open marketplace listing |
| Stacked-PR merge trap | ALWAYS: ancestry-verify before recording "merged" |

---

## Part 3 — Operating doctrine (running the machine without Fable)

The orchestration topology that produced today's throughput, so any capable
session (Claude Opus, codex, human) can resume it:

1. **Roles.** One strategic session holds final word and dispatches; the codex
   root session (resumable id in team memory) is the plan pack's single
   writer and the core-code track; Sol (`codex exec -m gpt-5.6-sol -c
   model_reasoning_effort=xhigh`) runs parallel tracks in dedicated worktrees;
   coding chunks go to `gpt-5.5-codex` (effort high); reviews to
   `claude -p --model claude-opus-4-8`. Agents open PRs; they never merge.
2. **Work orders are contracts.** Every dispatch carries: exact worktree +
   branch, scope boundaries (files it must NOT touch), the delegation loop to
   use, and machine-checkable acceptance criteria (build, tests, invariant
   greps, CI). Prose fidelity decays across model hops; checkable gates do not.
3. **Trust nothing unverified.** `codex exec` runs sandboxed by default: no
   network, ephemeral `/root` homes — commits can die with the sandbox while
   the report claims success (it happened today). Launch pushing runs with
   sandbox bypass; verify every claimed SHA with `git cat-file -e` +
   `git ls-remote`; record "merged" only after `git merge-base --is-ancestor`.
4. **Quota is the real scheduler.** All codex-driven models share one 5h
   window; cap concurrent codex tracks at 2. Claude session limits gate
   review passes. When a window saturates: commit + push first, stop clean.
5. **Docs discipline.** The plan pack has one writer (codex root). Other
   sessions add NEW files or PR against their own branches. Every owner
   decision lands in DECISIONS.md or a PLAN.md the same day it is made.
6. **Grill before build.** The repo skill `.agents/skills/grill-for-unknowns`
   encodes the method that shaped today: quadrant ledger, seven lenses,
   material/grounded/answerable filter, one question at a time, rulings
   recorded immediately. Run it on every new epic and every vision pivot.
7. **The owner's time is the scarcest input.** Batch questions; ask only
   material+grounded+answerable ones; always attach a recommended answer;
   record rulings verbatim the moment they land.
