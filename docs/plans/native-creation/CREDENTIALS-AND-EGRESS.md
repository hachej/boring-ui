# Credentials and egress — the model we adopt (2026-09-09)

> Source: Meta's Muse security write-up (research.meta.ai, September 2026),
> read 2026-09-09. This section records what we take from it for BYOK and for
> product runtimes, maps it to beads, and carries one proposed D33 addendum
> for the owner. Nothing here is ratified by itself.

## The lesson

Vaulting a key is not the point. The point is **where the real key exists**:
only at the network boundary, never in the agent, never in its runtime. Muse
mints **surrogate tokens** for the agent's cell and swaps them for the real
credential in an egress proxy. Prompt injection cannot leak what the process
never held. Three independent services decide, and all three must agree:
where credential-capable code runs, which credential a caller may receive,
and whether the action and its network request may happen at all.

## What we adopt

| Muse mechanism | Ours | Bead / status |
|---|---|---|
| Surrogate tokens minted by a credential service; real key substituted at egress | credential broker issues surrogates per installation and provider; the host egress proxy substitutes; the workspace's encrypted settings (D27) are read only by the proxy | `nc-c` (rewritten) |
| Per-caller credential allowlist ("a calendar worker cannot ask for an email credential") | per-installation allowlist: which providers and connectors an installation may receive surrogates for | `nc-c` |
| All egress through a policy proxy: hostname, resolved IP, port, method, path; SSRF-safe DNS | `local`/`remote` product runtimes have **no direct network**; all traffic via a host forward proxy with a per-installation allowlist and SSRF-safe resolution (reuse the MCP SSRF enforcement) | `nc-4b` (rewritten) |
| Three deciders: where code runs · which credential · whether the action | product runtime modes (§13c) · credential broker · capabilities + Inbox approvals (nc-x) — the proxy enforces the third for network | D33 addendum below |
| Approvals are capabilities, granted out of band, bound to destination and use case, with grant types one-time · session · task · time-bounded · perpetual | standing authorization (§13d) gets this vocabulary; Inbox cards offer the grant types the policy allows | `nc-x` |
| Tainted egress: processes that read user data lose auto-allow | policy rule: auto-allow only untainted, read-only, previously allowed destinations; anything that touched product data asks | `nc-4b` policy, later kernel taint |
| Browser broker: agent sees an accessibility tree, never raw DOM or JS; site passwords injected by the broker at login | the bot-computer spike: broker between agent and Chromium; take-control handoff unchanged; credentials never in the agent | spike brief |
| Safety classifiers outside the cell; untrusted-input labeling in the harness | open obligation: injection detectors run host-side so a compromised runtime cannot disable them | open |
| User VM is the system of record; memory as inspectable files; continuous backup; confidential VM later | product runtime durable volume holds memory as files the user can read and edit; sovereignty per D31 | Memories proposal (SENECA-EXPERIENCE) |
| Email connector strips one-time codes and magic links; single-use payment cards | connector-level rules for the products that need them | later, per product |

## What this changes in the beads

- **`nc-c` model credentials → credential broker.** Issues surrogate tokens
  per (installation, provider); never returns a real key to any runtime or
  builder; maintains the per-installation allowlist; usage rows carry
  installationId. The real key is read only by the egress proxy.
- **`nc-4b` local adapter.** "No egress by default" becomes "no direct network;
  egress only through the host forward proxy" with allowlist, SSRF-safe DNS,
  L4/L7 evaluation and surrogate substitution; the conformance suite adds a
  direct-connect attempt, a DNS-rebinding attempt and a surrogate-leak attempt.
- **`nc-x` authority.** Standing authorization carries the five grant types;
  an approval is bound to destination and use case.

## Proposed D33 addendum (owner to ratify)

> **Addendum (2026-09-09).** Credential-capable code, credential issuance and
> action/egress authorization are three independent host-owned deciders. A
> product runtime or builder receives only surrogate credentials; real
> credentials are substituted by the host egress proxy at the network
> boundary and never enter a runtime, a sandbox, a transcript or a prompt.
> Product runtimes in `local` and `remote` mode have no direct network path.
> Approvals are capabilities with a grant type (one-time, session, task,
> time-bounded, perpetual) bound to a destination and a use case.
