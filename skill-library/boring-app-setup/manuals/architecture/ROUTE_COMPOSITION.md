# Boring App Setup — Route Composition

Use this file when a child app needs pages beyond the stock workspace route.

## What `CoreWorkspaceAgentFront` gives you

`CoreWorkspaceAgentFront` already wraps the app in core auth/config/providers and accepts extra `<Route>` children.

That is the right default for:

- authenticated product pages
- extra workspace-adjacent pages
- settings/billing/help pages that should live inside the authenticated shell

## Auth reality

Current core front wraps routes in `AuthGate` and only a small public path set is treated as public.

Practical consequence:

- authenticated custom routes are easy
- public marketing/landing/custom unauthenticated flows need deliberate composition, not hand-waving

## Default rule

### If the extra page should require auth

Keep using `CoreWorkspaceAgentFront` and add route children.

### If the extra page should be public

Stop and decide intentionally whether:

- it belongs outside the core authenticated shell, or
- the app needs a lower-level custom front composition

Important: dropping from `CoreWorkspaceAgentFront` to `CoreFront` is not automatically enough for a truly public shell. Current core front composition mounts workspace-aware providers before the auth gate, so public/non-auth experiences need a deliberate lower-level composition decision.

Do not casually promise “just add a public route” without checking the actual auth gate behavior.

## Suggested planning output

For any app with extra pages, say explicitly:

```txt
Route composition
- Authenticated routes:
  - ...
- Public routes:
  - ...
- Front composition choice:
  - CoreWorkspaceAgentFront only
  - or lower-level custom composition needed
```

## Rule

Authenticated extra routes are the default happy path.
Public custom flows need an explicit composition decision.
