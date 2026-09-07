# Boring — the vision, one edition (2026-09-07)

This is the readable, consolidated statement of what Boring is and how it is
built, written in the present tense from every ruling in force on
2026-09-07. It **decides nothing new**. Each chapter ends with a crosswalk to
the ruling it restates; [`CROSSWALK.md`](CROSSWALK.md) is the full map, and the
append-only ledgers remain the authority when wording differs:

> User/owner rulings > [`DECISIONS.md`](../DECISIONS.md) + [`RECONCILIATION.md`](../plans/long-term/ratified/RECONCILIATION.md) >
> [`DIRECTION.md`](../direction/DIRECTION.md) for *when* > this edition for *what* > everything else.

Earlier readable versions live in [`history/`](history/); the exploration ledger
is [`explorations.md`](explorations.md).

## The one paragraph

An expert creates useful software inside Seneca, uses it to do a job, changes
its method and interface, installs it for someone else, and keeps it working
through upstream updates — without a founder editing source. Boring is the
substrate that makes that dependable: a governed job root (Thread), semantic
Views over domain records, agents that act inside a durable job under one
authority funnel, immutable releases installed per consumer and run in their
own isolated runtime, and evidence bound to the exact software that did the
work. Pricing, offers and go-to-market live in the tenant; the platform ships
neutral substrate.

## Read in this order

| # | Chapter | Answers |
|---|---|---|
| 1 | [Product and journey](01-product-and-journey.md) | What is being built, for whom, and what "done" means |
| 2 | [Jobs and Threads](02-jobs-and-threads.md) | The unit of work, conversations, runs, durability |
| 3 | [Views and Experiences](03-views-and-experiences.md) | How people see and steer work; where a product lives |
| 4 | [Software evolution](04-software-evolution.md) | Release, installation, activation, change, reconciliation |
| 5 | [Agents and multi-agent](05-agents-and-multi-agent.md) | Agent packages, Seats, builder vs domain agents, teams |
| 6 | [Authority and isolation](06-authority-and-isolation.md) | One funnel, capabilities, sandboxes, runtime modes |
| 7 | [Data, knowledge and evidence](07-data-knowledge-evidence.md) | Records, operations, evaluation, cost |
| 8 | [Platform, tenants and delivery](08-platform-tenants-delivery.md) | Platform/tenant split, execution home, the factory |
| — | [Crosswalk](CROSSWALK.md) | Chapter section → ruling |

## Vocabulary (one line each)

- **Thread** — one durable job; binds zero or more **Sessions** (runtime conversations).
- **Run** — one admitted agent execution inside a Thread; identified by its request key.
- **View** — a semantic descriptor (collection, record, document, dashboard…) resolved by the host; agents never see renderers.
- **Experience** — a composed product surface over the substrate; Meridian is the flagship, not the only one.
- **Agent** — a packaged persona with skills, knowledge and tools, identified by a content digest.
- **Seat** — an agent's participation in a workspace; grants participation, never identity.
- **Product** — an installable unit: agents plus operations, schema, Views and evidence, under one release identity.
- **Release** — an immutable, content-addressed manifest of a product.
- **Installation** — a release bound to a scope (workspace or person), resources, grants and a runtime mode.
- **Activation** — the compare-and-set act that makes a release the installation's active one; undo is another activation.
- **Product runtime** — the durable, isolated process serving one installation (`embedded` · `local` · `remote`).
- **Sandbox** — a disposable environment lease for tool calls, builds and checks; never a product host.
- **Builder** — the agent class allowed to write software inside a candidate; it never activates.

## What this edition is not

Not the schedule (DIRECTION alone answers *when*), not a claim that anything
described is built (the crosswalk marks implementation status), and not a new
abstraction pass: the ontology frozen in 2026-08 stands, with the 2026-09-07
rulings folded in.
