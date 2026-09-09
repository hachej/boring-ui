# R-33-12 — Profiles, bundles and patch layers for the external-plugin epic

Status: proposed · Source: DeepSeek `docs/architecture.md` (composition)
Kind: design · Cost: **medium** (repriced 2026-08-14) · Priority: medium (feeds the senecaapp.ai epic)

## Claim

Give the external-plugin epic DeepSeek's composition model: a **profile** is a
named, locally-stored composition; **bundles** are the distribution format for
config *and* code; **patch layers** apply in a defined order over an empty entry
list. Users customize by adding layers, never by forking.

## Why

The epic's requirement is "a user codes their own UI + agent as a boring plugin",
with smart defaults giving a wow-effect onboarding and full customization still
available. Those two pull in opposite directions unless defaults and overrides
are the *same mechanism at different layers*. That is precisely what profiles +
patch layers buy: the default experience is a stock bundle, and customizing is
appending a patch, so there is no cliff between "using the product" and
"extending it".

eve gave us extension mount namespaces; DeepSeek gives the layer ordering and the
distribution unit. Together they are a complete answer to the epic's shape.

## Evidence

- DeepSeek: *"profiles (named compositions stored locally) and bundles (distribution formats for configuration and code); layers apply to an empty entry list in [order]: bundles from the profile, then patches at multiple levels, allowing flexible customization without modifying core code."*
- Their plugin discovery is a GitHub topic (`dsh-plugin`) — zero-infrastructure registry, worth copying for v0 rather than building one.
- Their Python and native SDKs mean out-of-process plugins are first-class from day one.

## What it costs

**Repriced 2026-08-14 — medium, not high.** The seam census found six seams
already built (`SandboxProviderV1` with 7 implementations, `EventStreamStore`,
MCP grants, scope). None is selectable at composition time. So this is a
selection layer over existing interfaces, not new architecture. See R-33-14,
which carves out the non-epic half as independently shippable.

## What it breaks

Nothing today — the external-plugin path is not shipped. It does constrain the
epic's design, which is the intent.

## Blocking prerequisite

**External plugins are currently imported into the unsandboxed host.**
`runtimeBackendRegistry.ts:228,241,243` filters `source.kind === "external"` and
calls `importServerModule(serverPath, true)`, then `captureRuntimeRoutes` runs
`runtimePlugin.routes(router)` — direct contradiction of `PLUGIN_SYSTEM.md`
("Route-free; no `boring.server`"). Shipping user-authored plugins on top of this
is remote code execution as a feature. This is tracked privately and gates the
whole epic.

## Refutation

If our plugin surface turns out to be narrow enough that a flat config with
overrides covers it, layers are over-engineering. Test: enumerate what a
senecaapp.ai user must override to ship a custom UI + agent. If it is under ~5
keys, take the flat config.
