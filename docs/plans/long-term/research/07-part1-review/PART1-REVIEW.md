# Review — Part 1 (2026-08-17-final) × the W33 framework research

Reviewer context: five framework scouts (Flue, eve, opencode, DeepSeek dsh,
Cloudflare Think), four code censuses of the current repo, six executable
spikes, three adversarial review passes. Every enhancement below is grounded in
something that cycle **verified in code or refuted by spike** — not taste.

**Verdict first:** no structural error found. The plan independently converges
with the proven engineering (effect taxonomy = our ratified effect classes;
outcome-unknown = the accepted-work contract; produced/delivered/successful =
record/envelope discipline; §5.9's evaluator rules = our promotion gates;
second-cycle rate = the ratified MVP metric). That convergence, from a third
independent derivation path, is strong evidence the capability space is right.
Nine targeted enhancements follow, ordered by importance.

---

## E1 — Payer binding is a structural relation, not a billing detail

**Rationale.** The plan's §4.11/§5.16 separate usage facts from pricing —
correct — but never state WHERE the payer is bound. The W33 audit **verified a
live defect** in the current codebase (F-33-G15): cached model registries plus
ambient host credentials create a model-invocation path that never consults the
customer's own key — the platform silently becomes the payer. Every commercial
model in §5.16 (BYO-provider, publisher revenue share, per-job pricing,
committed spend) is unenforceable if payer binding can be bypassed by ambient
environment. This is exactly the class §1.4 calls STRUCTURAL: retrofitting
payer identity after customers have usage history is the expensive case.

```diff
 5.16 ... Commercial-layer separation
     Settlement and payout: allocation among platform, publisher, developer, customer, and provider.
 
 The structural premise is accurate, durable usage and cost attribution. Those facts are not invoices.
+
+Payer binding is itself structural: the payer of a model, tool, or provider
+call is determined by explicit policy at Work admission, and provider
+credentials are resolved per admitted execution under that policy. Ambient
+runtime credentials, cached provider clients, or residual process environment
+must never silently determine who pays. A usage fact whose payer cannot be
+named is an incident, not telemetry.
```
```diff
 12.2 Structural relations Part 2 must preserve
     usage facts are distinct from entitlement, pricing, billing, collection, and settlement;
+
+    the payer and provider-credential policy for an execution are bound at
+    admission and resolved per execution, never inherited from ambient
+    runtime environment;
```

## E2 — Admission precedes execution; usage attaches only to admitted identity

**Rationale.** §5.3 already requires "a stable execution identity for every
non-trivial admitted unit," but the ORDERING is what makes recovery, billing,
and the evidence join work: the identity is minted by the admitting authority
BEFORE execution and remains stable across retries, metering, delivery, and
outcomes. This was independently derived three times in our program (the
accepted-work contract; the ratified Run identity; the plan's own §2.4) — but
the plan never states it as a preservation requirement, which is where it
belongs, because bolting admission-first onto an execute-first system is a
rewrite.

```diff
 12.2 Structural relations Part 2 must preserve
     one durable execution identity joins cost, effects, Artifacts, decisions, and delayed Outcomes;
+
+    that execution identity is created at durable admission, before execution
+    begins; execution without prior admission is invalid, and usage facts,
+    Artifacts, and evidence attach only to admitted identities;
```

## E3 — The facts plane is separable from the content plane

**Rationale.** §5.15 wants "diagnostics ... without violating customer privacy"
and §5.14 sells sovereignty — but nothing guarantees these are POSSIBLE. The
scout work found the concrete hazard: mainstream observability integrations
capture prompt/content by default (verified in a competing framework's
telemetry adapters). The guarantee needs to be structural: status, cost,
attention, and audit facts derive from an operational plane that never
contains Work content. This is also what makes support-safe redaction (§5.15)
and the platform-operator boundary (§2.6) real rather than aspirational — and
it is cheap now, expensive later.

```diff
 5.14 ... Sovereignty means more than data location.
+
+Sovereignty also requires plane separation: operational facts (status, cost,
+latency, attention, audit trail) must be fully derivable without access to
+Work content, prompts, Source data, or Artifacts. Support, platform
+diagnostics, metering, and publisher analytics read the facts plane; the
+content plane never leaves the Instance boundary except through the explicit
+transfer forms of §2.7. An observability or billing integration that captures
+content by default violates this boundary.
```
```diff
 12.2 Structural relations Part 2 must preserve
     cross-boundary movement is explicit and auditable.
+
+    operational facts (status, cost, attention, audit) are derivable without
+    reading Work content; telemetry, metering, and support tooling consume the
+    facts plane only.
```

## E4 — Approval validity: revision-binding, expiry, and channel step-up

**Rationale.** The plan binds approvals to the exact Work/Operation/input/
Artifact revision (§3.4.4, §5.10) — right. Two verified gaps remain. (1) An
approval must become VOID when the proposal changes: the strongest known
mechanism (verified in Cloudflare's approval design) aborts at the unapproved
action, records completed steps, and re-applies only at the same stable
position — approval of step N is invalid if steps 1..N-1 changed. (2) Channel
identity strength differs: our audit found a live case where a self-asserted
identity header could mint authority. A WhatsApp phone number is weaker
evidence than an authenticated app session; the effect class should be able to
demand a stronger channel.

```diff
 5.2 ... preserve the same approval semantics across products and channels.
+
+    an approval binds to the exact proposed Operation, inputs, plan position,
+    and Artifact revision, and becomes void if any of these change; expired,
+    revoked, or superseded approvals cannot be replayed;
+
+    channel identity carries a strength class; approval of higher effect
+    classes may require step-up to a stronger channel (for example: intake by
+    WhatsApp, approval in the authenticated application), set by product
+    policy;
```

## E5 — Platform-bound Operation arguments (the confused-deputy control)

**Rationale.** §5.6 correctly makes Source content data-not-authority. The
complementary control is missing: sensitive Operation ARGUMENTS (tenant,
Instance, payer, recipient domain, resource identifiers) must be bindable by
the platform from authorized context so the model cannot select them — with
the binding snapshotted for the execution. Without this, prompt-injected
content doesn't need authority; it only needs to influence an argument on an
already-authorized call. This pattern is production-proven in two surveyed
frameworks (model-hidden provided arguments; frozen per-session tool config).

```diff
 5.5 ... The Agent should receive only the Operations relevant to current Work and authority, rather than the full catalog in every prompt.
+
+Platform-bound arguments
+
+An Operation may declare arguments as platform-bound: their values are
+supplied by the platform from the authorized Work context — Instance, payer,
+tenant, target record, allowed recipient set — and are never selectable by
+the model or influenced by Source content. Bindings are versioned and
+snapshotted per execution, so a replayed or audited execution shows exactly
+which bound values applied.
```

## E6 — Gates must be demonstrably load-bearing

**Rationale.** §5.9 and §3.5 version the evaluators and forbid swapping an
evaluator with its subject — good. Our cycle found the failure mode one level
deeper, empirically: a test suite stayed fully green after the constraints it
claimed to verify were deleted (17/17 passed; the invariants lived in the
adapter, not the database). The same rot threatens every automated review gate
in the factory: a gate that never fails degrades into decoration while still
lending legitimacy to promotions. The capability is efficacy verification —
prove periodically that removing or violating the gated property fails the
pipeline.

```diff
 3.5 ... Factory invariants
     automated review gates are versioned evaluators, not unquestioned truth;
+
+    a gate must be demonstrably load-bearing: the factory periodically
+    verifies that violating the gated property actually fails the pipeline;
+    a gate whose removal changes no outcome is decoration and is treated as
+    a defect;
```

## E7 — Composition collision semantics are explicit and immutable

**Rationale.** §5.13 requires namespaced contributions, but namespacing alone
does not answer: what happens when two Packages contribute the same Operation
name, or a Package wants to extend a built-in? Our census found the current
system resolves this by ARRAY ORDER (first registration wins, silently) — the
worst possible answer, and one that's already shipped. The proven vocabulary
(verified in a surveyed framework): disable / alias / wrap-with-trusted /
replace-with-already-admitted — compiled into an immutable binding at install
time, never resolved at runtime by order.

```diff
 5.13 Multi-application
     namespaced contributions;
+
+    explicit collision resolution when contributions overlap: an installed
+    composition declares disable, alias, wrap, or replace for each conflict,
+    compiled into an immutable binding; resolution is never dependent on
+    registration or load order;
```

## E8 — Last-known-good delivery and honest recovered state

**Rationale.** §5.3 handles failure of the CURRENT attempt (outcome-unknown,
no silent retry). Two adjacent, production-proven behaviors are missing. (1)
Stale-good: when a refresh, regeneration, or evaluation fails, the previous
valid result stays visible with an explicit staleness marker — a dashboard
that goes blank because one job failed is a regression, and "incumbent remains
active on challenger failure" is this same rule at the promotion level. (2)
Recovered-state honesty: after a mid-flight failure, the resumed Work shows
exactly what is known, what is unknown, and what was rolled forward — this is
also missing from §7 as a proof capability, where it is arguably the single
most trust-building demo the platform can give.

```diff
 5.3 ... A product that drafts brilliantly and cannot recover from a mid-flight failure is a demo, not software.
+
+    last-known-good presentation: when refresh, regeneration, or evaluation
+    fails, the prior valid result remains available with an explicit
+    staleness marker; a failed challenger never displaces a working
+    incumbent;
+
+    recovered-state honesty: resumed Work shows exactly which steps are
+    confirmed, which effects are unknown, and which results are stale;
```
```diff
 7.9 Local/degraded mode
+
+7.9b Mid-flight failure survival
+
+A Work item interrupted by process, provider, or sandbox failure resumes on
+the same durable identity, displaying confirmed steps, unknown external
+effects awaiting reconciliation, and costs already incurred — with no
+duplicated external effect and no silent retry.
```

## E9 — The Objective question belongs in the open questions

**Rationale.** The noun budget (§12.1) folds the goal into Work ("a goal or
request"). For Operate that's right. For Improve it leaves a real ambiguity:
incumbent comparison (§5.9) needs a STABLE COMPARISON BASIS across many Work
items over months — "define better, define the incumbent" must outlive any
single Work item, or every comparison re-litigates its own criteria. Whether
that basis is Work metadata, a shared referencable identity, or part of the
Package should be Part 2's explicit call, not an accident. One line keeps the
budget honest without minting the noun prematurely.

```diff
 11. Business questions intentionally left open
     Which outcome signals are robust enough for automated or policy-based promotion?
+
+    For Improve-heavy products, is the declared objective and acceptance
+    basis Work metadata, a durable shared identity referenced by many Work
+    items, or part of the Package — given that incumbent comparison requires
+    a comparison basis that outlives any single Work item?
```

---

## What I checked and found already covered (no change proposed)

Bounded catalog / progressive Operation discovery (§5.5 — matches the measured
2.9k-vs-10.3k exposure results) · evaluator/promotion separation (§5.9) ·
channel ≠ Work identity (§3.4) · effect taxonomy incl. compute/simulate as a
class we hadn't split (§5.5 — their taxonomy is better than ours; adopt
upstream) · attention budget (§5.2) · Goodhart/leakage (§5.9) · memory-scope
promotion rules (§5.4) · deterministic kernel (§5.5) · second-cycle metric
(§10.2) · anti-proliferation rules (§12.4).

One upstream adoption in return: the plan's `compute/simulate` effect class
(pure deterministic calculation, distinct from observe) is a genuine
improvement over the four-class taxonomy in our engineering spec — the
engineering side should adopt the five-class version.
