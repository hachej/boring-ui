# Architecture Decision Records (ADRs)‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

ADRs are the institutional memory of a project. "Why did we do it this way?" is the single most common question from new contributors, and the single most expensive to answer without a record.

This file covers ADRs as first-class documentation content: the template, the placement, the link patterns, and the lifecycle.

---

## What an ADR is (and isn't)

**An ADR is** a short document (typically 1–2 pages) that captures:
- A significant architectural decision
- The context and constraints that shaped it
- The alternatives considered
- The decision itself and its consequences

**An ADR is NOT**:
- A spec (that's reference)
- A design doc for upcoming work (that's a proposal, separate artifact)
- A postmortem (that's a different genre)
- A blog post (blog is marketing, ADRs are archival)

### When to write one

Write an ADR when a decision:

- Is **hard to reverse** (database choice, protocol choice, deployment model).
- **Constrains** future decisions (coding conventions, serialization format).
- Was **contentious** during discussion (team disagreed; the winning argument should be preserved).
- Affects **cross-cutting concerns** (auth, observability, error handling).
- Will be **asked about repeatedly** ("why do we use X and not Y?").

Don't write an ADR for:

- Minor implementation choices ("we renamed the function", "we switched from for-loops to map()").
- Cosmetic decisions (color palette, icon style — though these may be in a design-system doc).
- Short-lived experiments (unless the experiment outcome IS the decision).

---

## Template: MADR (Markdown Architecture Decision Record)

The [MADR](https://adr.github.io/madr/) template is the de facto standard. Slightly adapted for Nextra:

```mdx
---
title: 0042 — Use SQLite for local state
description: Use SQLite with WAL mode for all local-state persistence.
status: Accepted
date: 2026-04-15
deciders: [alice, bob]
consulted: [charlie, danielle]
informed: [team]
tags: [storage, durability]
---

# 0042 — Use SQLite for local state

**Status**: Accepted (2026-04-15)
**Deciders**: @alice, @bob
**Consulted**: @charlie, @danielle

## Context

We need to persist user state between CLI invocations. Requirements:

- Zero external dependencies (we don't want Postgres on a laptop)
- ACID durability (data must survive crashes)
- Works offline
- Data volumes < 100 MB typical
- Written from one process at a time (no concurrent writers)

Previous hand-rolled JSON-file approach had corruption on kill-9 (see [issue #123]).

## Decision

Use SQLite with WAL mode as the sole local-state persistence layer. Access
through `rusqlite` with `bundled-sqlcipher` feature for on-disk encryption.

## Alternatives considered

### JSON file with fsync

- Pros: simplest; human-readable; no deps
- Cons: no atomic multi-key updates; corruption under crash; slow for large files​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌

### RocksDB / sled

- Pros: high performance; native Rust
- Cons: no SQL; harder for users to inspect; more opaque

### Postgres in embedded mode

- Pros: familiar SQL; mature
- Cons: not truly embedded (requires running the server); overkill for our
  data volume

## Consequences

**Positive:**
- Crash-safe via WAL.
- Inspectable with `sqlite3` CLI.
- Single file; easy to back up / copy / version.
- Encrypted at rest via SQLCipher.

**Negative:**
- Locks the project to SQLite idioms (UPSERT syntax, RETURNING clauses).
- WAL files (`-wal`, `-shm`) alongside the main `.db` file can confuse users.
- Migration path if we ever need multi-writer: painful.

**Neutral:**
- Team needs to learn SQL + rusqlite.

## References

- [Issue #123: JSON corruption](https://github.com/org/repo/issues/123)
- [SQLite WAL mode docs](https://www.sqlite.org/wal.html)
- [ADR-0041](./0041-embedded-vs-server) — prior decision: embedded only
- [Storage module architecture](../concepts/storage)
```

### Field reference

- `status` — `Proposed` / `Accepted` / `Superseded by ADR-NNNN` / `Deprecated` / `Rejected`
- `deciders` — who had authority to decide
- `consulted` — whose input was sought
- `informed` — who was notified after
- `date` — when the status changed (accepted, superseded, etc.)
- `tags` — for finding related ADRs

---

## Numbering & naming

ADRs use sequential numbering with 4-digit zero-padding: `0001`, `0002`, …, `0042`.

Filename: `content/adr/0042-use-sqlite-for-local-state.mdx`.

The number IS the stable identifier. Titles can evolve (rarely), numbers don't.

Some projects prefer date-prefixed: `2026-04-15-use-sqlite-for-local-state.mdx`. That works too but makes reordering by importance harder. Pick one convention, stick with it.

---

## Placement in the doc site

Canonical location: `content/adr/`.

```
content/
  adr/
    index.mdx                         # List of all ADRs with status
    0001-project-charter.mdx
    0002-use-rust.mdx
    0042-use-sqlite-for-local-state.mdx
```

`content/adr/index.mdx` is a Cards-like index:

```mdx
---
title: Architecture Decision Records
description: Why we built <project> the way we built it.
---

# Architecture Decision Records

We record every significant architectural decision as an ADR. These are
historical — each one reflects the thinking at its date of acceptance and
should not be edited afterward. When a decision is superseded, a new ADR
supersedes it and links back.

| # | Title | Status | Date |
|---|-------|--------|------|
| [0001](./0001-project-charter) | Project charter | Accepted | 2024-01-10 |
| [0002](./0002-use-rust) | Use Rust as primary language | Accepted | 2024-01-15 |
| ... | ... | ... | ... |​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
| [0042](./0042-use-sqlite-for-local-state) | Use SQLite for local state | Accepted | 2026-04-15 |
```

Generate this table with `scripts/adr-index.mjs` from ADR frontmatter.

---

## Immutability

Once an ADR is Accepted and published, **do not edit the substance**. You can:

- Fix typos, formatting.
- Add a "Superseded by #N" line at top.
- Add additional Consequences observations discovered later (as a `## Postscript` section dated).

**Do not**:

- Change the Decision.
- Change the Context as it was at the time.
- Delete alternatives considered.

If thinking evolves, write a new ADR that supersedes the old one. The old one stays.

---

## Supersession

When decision 0042 is replaced by decision 0067:

```mdx
---
title: 0042 — Use SQLite for local state
status: Superseded by ADR-0067
...
---

> **Status**: Superseded by [ADR-0067 — Migrate to DuckDB](./0067-migrate-to-duckdb).
> This ADR is preserved for historical context.

<original content here>
```

And in 0067:

```mdx
## Context

Supersedes [ADR-0042](./0042-use-sqlite-for-local-state), which chose SQLite.
New requirements (analytical queries, columnar data) make SQLite a poor fit.
```

Bidirectional links. Readers land on either ADR and understand the arc.

---

## Linking from concept and reference pages

ADRs aren't read by readers just browsing docs. They're **referenced from other pages** when a concept page says "we chose X":

```mdx
# Storage

<project> persists all local state in a single SQLite database in WAL mode.

See [ADR-0042](../adr/0042-use-sqlite-for-local-state) for the reasoning
behind this choice.
```

This gives curious readers the escape hatch without bloating the concept page.

---

## The ADR lifecycle in the source repo

Option A: ADRs in the docs repo only.
- Simpler for the docs-as-code setup.
- Drawback: commit history of the ADR is divorced from the code commit that landed the decision.

Option B (recommended): ADRs in the source repo, mirrored into the docs site.
- Source repo: `adrs/0042-use-sqlite-for-local-state.md`.
- Docs site: symlink or CI-copy into `content/adr/0042-...mdx`.
- Commit history shows the ADR landing alongside the implementing PR.
- PR template requires a link to the ADR for any "architecturally significant" change.

```yaml filename=".github/pull_request_template.md"
## Architectural impact

- [ ] This PR introduces a new architecturally significant decision
- [ ] If so, ADR filed at: `adrs/NNNN-title.md`
```

---

## Generating an initial ADR set

When starting a new docs site for an existing project, mine ADRs from history:

1. **Read the repo's design docs** (RFC folder, decision logs, wiki). Port each as an ADR.
2. **Read top issues with `architecture` / `design` labels** — each major thread is often worth one ADR.
3. **Read key PR descriptions** for controversial changes — "why did we do this?" comments signal ADR-worthy content.
4. **Interview the team** — one hour with the longest-tenured contributor surfaces 5–15 implicit ADRs.

Number them by acceptance date (approximation ok for historical reconstruction). Number 0001 by tradition is often the project charter (when and why the project was created).

### Subagent: ADR miner (optional addition)

Create a Phase-3-adjacent subagent prompt:​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍

```
Read the source repo at {SOURCE_PATH}. Identify all architecturally significant
decisions evident from:
- Top-level README and CONTRIBUTING.md
- Issues with label "design" or "architecture"
- Merged PRs with descriptions >300 words about rationale
- Any RFC/ADR folder

For each, draft an ADR using the MADR template. Assign sequential numbers
starting 0001. Populate:
- Context from the issue/PR prose
- Decision from the merged change
- Alternatives from the discussion (often comments in issues)
- Consequences from follow-up issues / changelog

Save to content/adr/NNNN-slug.mdx. Cap at 15 ADRs; pick the most load-bearing.
Update content/adr/index.mdx.
```

Run this in Phase 3 or separately as an "ADR bootstrap" pre-task.

---

## Metrics

An ADR-healthy project has:

- **Total ADRs**: 5–50 for most projects. Under 5 = undercooked; over 50 = possibly over-ADRing (some might be better as concept pages).
- **ADR-to-concept-page ratio**: roughly 1:1. Every major concept has an ADR; every major ADR is referenced from a concept page.
- **% ADRs "Accepted"** (not Proposed or Rejected): >80% suggests healthy decision hygiene.
- **Mean time to first ADR after major change**: <2 weeks. Longer = institutional memory already lost.

Track on the `phase_lifecycle_dashboard.md` (see [LIFECYCLE.md](LIFECYCLE.md)).

---

## Relation to Design Docs / RFCs

ADRs and design docs are different:

| | Design Doc / RFC | ADR |
|---|---|---|
| Purpose | Propose a change | Record a decision |
| Time horizon | Prospective | Retrospective |
| Length | Usually long (5–20 pages) | Short (1–2 pages) |
| Lifecycle | Proposed → Approved → Closed → (archived) | Accepted → (sometimes) Superseded |
| Where | `rfcs/` folder or team wiki | `content/adr/` |

An RFC *produces* an ADR. Once the RFC is approved, the ADR captures the decision in condensed form. The RFC can stay in the repo as historical detail; the ADR is the canonical reference.

---

## Anti-patterns

- **ADR-less projects** — decisions exist but aren't written down. Six months later, no one remembers why. Expensive.
- **ADR-everything** — every tiny change gets an ADR. Signal-to-noise collapses. Threshold: if the question "why?" would genuinely be asked later, ADR it; else no.
- **Edited-after-acceptance ADRs** — breaks the archival contract. Write a new one that supersedes.
- **Alternatives section omitted** — the most valuable part of the ADR. "What else did you consider?" is half the reason future readers come back.
- **Marketing voice** — "we chose this beautiful, elegant approach." Neutral technical voice; state the reasoning.
- **ADRs that contradict each other without supersession** — means no one's tracking the graph.
- **ADRs filed weeks after the code lands** — decision is already entrenched; ADR becomes theater. File before or alongside the implementing PR.
- **Index page that's out of date** — automate the index generation from frontmatter.

---

## Integration

- [OPERATOR-LIBRARY.md](OPERATOR-LIBRARY.md): the `⊕ SYNTHESIZE` operator creates `content/overview/architecture.mdx`, which should link out to relevant ADRs.
- [DIATAXIS.md](DIATAXIS.md): ADRs are Explanation quadrant. Theoretical, understanding-oriented.
- [CONTENT-TEMPLATES.md](CONTENT-TEMPLATES.md): add the MADR template here.
- [LIFECYCLE.md](LIFECYCLE.md): ADRs accumulate over the project lifecycle; sunset phase archives them.
- [AUDIENCE.md](AUDIENCE.md): contributors are the primary ADR readers.

---

## Worth reading on the broader topic

- https://adr.github.io/ — the ADR GitHub organization, with templates and tooling.
- https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions — Michael Nygard's original post.
- https://blog.pragmaticengineer.com/documenting-architecture-decisions/ — The Pragmatic Engineer's overview.

Link these from your `content/adr/index.mdx` for readers who want the broader context.
