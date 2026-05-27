# Boring App Setup — Provisioning Patterns

Use this file when a child app needs seeded workspace/runtime setup.

## When provisioning is in scope

Provisioning is in scope when the app needs things like:

- starter workspace files
- templates owned by the app/plugin
- SDK/runtime helper files
- runtime workspace materialization before the agent starts

## When provisioning is NOT the right answer

Do not reach for provisioning just because:

- the app has normal backend data
- the app needs ordinary routes/services
- the UI needs a panel or catalog

Provisioning is for **workspace/runtime setup**, not for general app architecture.

## Good generic pattern

1. keep the app shell simple
2. put provisioning ownership in trusted app/server/plugin composition
3. keep templates/seeded assets clearly app-owned
4. verify provisioning separately from basic app boot

## Questions to ask

- does the product require files/assets to exist in the workspace before use?
- does the runtime need extra setup to make the product useful?
- is the setup generic enough to be a template, or is it really request-time data?

## Verification checklist

If provisioning exists, verify:

- expected workspace assets appear
- runtime setup runs in the intended mode
- app still boots without unrelated provisioning drift
- deploy docs mention provisioning-specific checks

## Rule

Provisioning should be explicit, minimal, and testable.
Do not hide core product assumptions in mysterious startup side effects.
