# 3. Views and Experiences

## Views are semantic, renderers are implementation

A **View** is a descriptor: a kind (collection, record, document, kanban,
timeline, dashboard, inbox, chart, table, map, artifact), a subject, an
optional query, the actions it exposes, and presentation hints. The host
resolves a descriptor to a renderer; agents reason about descriptors and
references, never about panes, tab ids, CSS or component names. The
contract ships **as a set** — descriptor, resolver, host, context, reference
— and no lookalike descriptor is minted in a product layer while the set is
unbuilt.

Saved Views in the Library wait for that first slice. The native-creation
journey is that slice's first consumer: the tutor product's record and
dashboard Views are real descriptors from day one.

## Experiences compose independent choices

An Experience is a product surface composed over the substrate from
independent choices: domain resources and operations, primary surfaces and
navigation, agent presence, work initiation, and scoped context. Chat-first,
document-first, conventional SaaS, embedded and headless are recipes of those
choices, not separate runtime stacks behind a mode switch. Reusable units
compose below the pane: a document viewer, a query-backed table, a review
action, an assistant entry point.

Two rules follow. A layout or presence choice grants no authority and
enables no trigger. Opening a record must not require mounting chat or
starting inference.

## Meridian and the product canvas

The flagship operator Experience is the multi-agent workspace shell: Search
on top, then Inbox, Work, Agents and Library over one workspace. It is
settled as the flagship and is **not** mandatory for every product. An
expert product opens as a job in Work with its own canvas; a learner never
navigates an operator roster to resume a lesson.

There is no global chat column. Conversation is contextual: beside a View or
inside a Thread. Transcripts are multi-author — one composer, several named
agents visibly authoring, with join, handoff and leave markers.

## Where a product lives

An installed product appears in the **Library** beside files and built-in
views, scoped to the members who hold the installation. Selecting it opens
Work with a Thread bound to the installation and the product's primary View;
reopening resumes the same Thread. No standalone workspace per product.

## Generated UI

A builder may produce new interface code. It is served from the product's
own runtime and, on shared hosts, rendered in an isolated frame with a
brokered bridge to the host; it is reached through a View reference, never
addressed by pane or plugin id, and it never runs in the authenticated host
origin. The declarative generated-pane vocabulary remains the lighter path
when a descriptor suffices.

## Crosswalk

| Section | Ruling | Built? |
|---|---|---|
| View contract as a set; agents never see renderers | RECONCILIATION §8(c)(3); VISION invariant 4; V2 spec L4 | bead `nc-v` (first slice) |
| Composable Experiences; recipes not modes | RECONCILIATION §11(f), §12(a) | — |
| Meridian flagship, other Experiences valid | RECONCILIATION §8(a) scope clause | shell chrome slices dispatchable; layout not built |
| No global chat column; multi-author transcript | §8(a); §9b | fixture only |
| Library entry, Thread in Work | DIRECTION 2026-09-07 "Library, not standalone workspaces" | bead `nc-l` |
| Generated UI isolation | §11(e), §13(c) | bead `nc-5`; prior PR #1499 |
