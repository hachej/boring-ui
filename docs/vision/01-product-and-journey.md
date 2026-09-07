# 1. Product and journey

## What Boring is

Boring is a substrate for expert software: the platform that lets a person
who knows a domain turn that knowledge into working software that others
use, without the platform's founders in the loop. Seneca is the first tenant
and first consumer; Boring holds only the neutral parts.

Three things compound over time and are therefore the platform's job:
the governed work substrate (jobs, authority, durability), the evidence
that ties results to the exact software that produced them, and the
lifecycle that lets software change safely. Everything visible is an
Experience over that substrate.

## The first complete journey

The product obligation, in order, is one journey that must pass end to end
before anything wider is claimed:

1. **Create.** A curator states intent, examples, judgment and authorization;
   a builder agent does the engineering and produces a candidate. Creation is
   itself a job.
2. **Release.** The candidate becomes an immutable, content-addressed release:
   code, behavior, schema compatibility, provenance and evidence, under one
   digest.
3. **Install for a separate consumer.** A second authorized person receives
   the release in their own scope, with their own data, grants and runtime.
4. **Run a real job.** The consumer completes work in a Thread; closing the
   browser, reconnecting or switching jobs never loses results or pending
   decisions; late results stay bound to their job.
5. **Adapt.** A retained change to method or interface survives as a new
   release and activation, without a founder edit or a global redeploy.
6. **Maintain.** A compatible upstream update keeps the private change; an
   incompatible one produces a precise conflict; undo never touches business
   records or already-completed effects.

Public discovery, marketplaces, revenue share, specialist models and owned
compute do not precede this journey. Private release and installation do
not wait for them.

## The journey as a matrix

| Stage | Capability it needs | Proof | Blocks today |
|---|---|---|---|
| Create | builder seat, typed intake preferred, sandbox lease, candidate manifest, evidence record | candidate exists with provenance; builder cannot activate | none of it built |
| Release | artifact publication, digest verification, dependency admission, host-only release op | bytes survive builder destruction; tampered byte fails | no release/artifact store |
| Install | installation record, requirements resolution + consent, personal-scope isolation | member B installs; member A cannot reach B's runtime/data | no installation record; membership is per workspace |
| Run | Thread identity, product runtime in `local`/`remote`, brokered operations, learner data store, Level D durability | job survives browser loss; results outside chat | Thread record, runtime seam, data store absent; Level D flag-off |
| Adapt | change intent record, activation with generation vector, preview isolation | retained change survives; preview cannot mutate real records | none |
| Maintain | compatibility check, three-way conflict, quarantine, undo, drain of pinned Runs | compatible update keeps intent; incompatible base yields one precise conflict | none |
| Live on Seneca | release delivery to the tenant, provisioning, hardware isolation for shared tenants | out of the first epic; named open obligations | open |

## Who is in the journey

- **Curator** — the expert; owns the product's method and its consumers.
- **Consumer** — a separate authorized user of an installed product; in the
  first proof, a learner.
- **Builder agent** — the only agent class that writes software; works in a
  sandbox, proposes candidates, never activates.
- **Domain agents** — the product's own agents; reason over semantic
  resources and Views, never renderer internals.
- **Host** — the platform process: identity, installation records,
  activation, brokering; it never runs product code outside the explicit
  embedded mode.
- **Founder** — measured, not required. The standing metric is founder
  interventions per accepted, retained adaptation, counted over every attempt.

## The first proof

A bounded mathematics tutor product, created by the Seneca curator and
installed for a second learner, then a nontechnical curator's real workflow.
The proof fails if a backend change goes back to the founder, installation
needs a global redeploy, destroying the builder sandbox loses the product,
switching jobs retargets late work, an update silently drops a private
choice, or a demo hides manual engineering. A configuration-only success
earns its own credit and does not close the obligation.

## What is deliberately not decided or not built

Public packaging, marketplace, creator revenue share, universal app or
schema generators, a product DSL, cross-tenant learning, self-modifying
production repositories, and arbitrary untrusted code in the host process.

## Crosswalk

| Section | Ruling |
|---|---|
| Journey, obligation, first proof, metric | RECONCILIATION §13(a), §13(g); native-creation README |
| Timing ahead of public packaging | §13(a) superseding VISION K9 / spec M8 |
| Roles: builder vs domain agents, host | §13(b), §13(e) |
| Non-goals | ratified VISION §8 and its 2026-09-05/07 scope amendments |
