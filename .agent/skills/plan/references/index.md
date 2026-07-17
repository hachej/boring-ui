# External Planning Reference Index

`/plan` selects one or more of these raw references. The files under this directory are copied verbatim from the installed/downloaded source noted below; do not edit them to add Boring policy. Boring governance remains under `docs/`.

## Jeffrey Emanuel — Planning Workflow

- **Read:** `jeffrey-emanuel-planning-workflow/SKILL.md`
- **Source catalog:** <https://jeffreys-skills.md/skills/planning-workflow>
- **Pinned bundle:** skill version `6`, bundle SHA-256 `fa212c33c34873bd2911f1e3f612bc940154ab166d944978f9150a4b5e5672f8`
- **Exact SKILL.md SHA-256:** `bfd6992205e03094e372d7d7eba4c7184810b78bc3b7aedbed373537c31c0a19`
- **Audit:** manifest bytes/hashes and current Ed25519 signing key verified on 2026-07-17.
- **Use when:** a design is uncertain, broad, or architectural and needs iterative refinement before execution.
- **Do not use when:** a single safe change can be represented by a tracked TODO or one small execution slice.

## Jeffrey Emanuel — Beads Workflow

- **Read:** `jeffrey-emanuel-beads-workflow/SKILL.md`
- **Source catalog:** <https://jeffreys-skills.md/skills/beads-workflow>
- **Pinned bundle:** skill version `4`, bundle SHA-256 `387da3eff5bde910458eb020a10d79d46b20399c7f26599b83adbc704a509f7c`
- **Exact SKILL.md SHA-256:** `7f63c88fc5b3ef519367ab90027473ee11ef5a75b2e4d98235527a9b02e11741`
- **Audit:** manifest bytes/hashes and current Ed25519 signing key verified on 2026-07-17.
- **Use when:** an approved plan has dependent slices or parallel delegated work requiring a self-contained `br`/`bv` graph.
- **Do not use when:** one agent can safely implement one slice without dependency management.

## Matt Pocock — Grill With Docs

- **Read:** `matt-pocock-grill-with-docs/SKILL.md`
- **Source:** <https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs>
- **Installed source:** `.worktrees/issue-109-plan/skill-library/mattpocock/grill-with-docs/SKILL.md`
- **Exact SHA-256:** `610d091047bcfb9db0f75c057d15538481a721111579fc5ec7f83ad9131a2165`
- **Use when:** desired outcome, vocabulary, or constraints are unclear; grill before creating a spec.
- **Do not use when:** enough intent already exists to synthesize a spec directly.

## Matt Pocock — To Spec

- **Read:** `matt-pocock-to-spec/SKILL.md`
- **Source:** <https://github.com/mattpocock/skills/tree/main/skills/engineering/to-spec>
- **Installed source:** `.worktrees/issue-109-plan/skill-library/mattpocock/to-spec/SKILL.md`
- **Exact SHA-256:** `267638edd513b5918de626ad5605d261952abb7428cb308869c663ca924e93e7`
- **Use when:** conversation and repository context are sufficient to synthesize a product/technical spec.
- **Do not use when:** critical intent remains unanswered; use Grill With Docs first.

## Matt Pocock — To Tickets

- **Read:** `matt-pocock-to-tickets/SKILL.md`
- **Source:** <https://github.com/mattpocock/skills/tree/main/skills/engineering/to-tickets>
- **Installed source:** `.worktrees/issue-109-plan/skill-library/mattpocock/to-tickets/SKILL.md`
- **Exact SHA-256:** `918bdefab9313100cb1f7ccb412e2a773fe2f2801dd20d44f6b2acf7a42ca456`
- **Use when:** an approved spec needs a small number of vertical implementation slices.
- **Do not use when:** a programme needs a full dependency graph; use Jeffrey Emanuel’s Beads Workflow.

## Jeffrey Emanuel — Automated Plan Reviser Pro

- **Read:** `jeffrey-emanuel-automated-plan-reviser-pro/README.md`
- **Workflow example:** `jeffrey-emanuel-automated-plan-reviser-pro/workflows/fcp-example.yaml`
- **Source:** <https://github.com/Dicklesworthstone/automated_plan_reviser_pro>
- **Pinned source commit:** `edd6bd19af61d78651e2e2ccb73be5ee7f226294`
- **Use when:** architecture, public contracts, migrations, security, or broad refactors need repeated deep review and convergence.
- **Do not use when:** standard independent plan review is enough.
