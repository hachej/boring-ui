# Boring App Setup — App Archetypes

Use this file to choose the right **kind** of child app before writing code.

## 1. Thin branded shell

Shape:

- mostly stock `full-app`
- identity/auth/mail/domain changes
- few or no custom plugins
- little app-owned backend logic

Use when:

- the product is mostly the boring chassis plus branding
- you are proving demand fast

Default choices:

- base app: `apps/full-app`
- plugin strategy: none or one small app/internal plugin
- backend ownership: keep logic minimal

## 2. Plugin-heavy workspace app

Shape:

- workbench is the product
- multiple custom panels/catalogs/resolvers
- maybe some trusted server plugins
- app shell still built on core

Use when:

- most value lives in the workspace UI
- agents open and control domain-specific surfaces

Default choices:

- base app: `apps/full-app`
- proving ground: `apps/workspace-playground`
- plugin strategy: app/internal plugin packages

## 3. Domain-backed app

Shape:

- custom domain backend logic
- app-specific data access/services
- trusted server plugins or app-owned server modules
- frontend uses workspace + chat as one surface among several

Use when:

- the app has real product logic beyond generic workspace chrome
- data/service rules matter as much as UI

Default choices:

- base app: `apps/full-app`
- backend ownership: explicit app/server modules and/or trusted server plugins
- transport choice: decide bridge vs route deliberately

## 4. Provisioned runtime app

Shape:

- child app needs templates, SDKs, runtime workspace materialization, or long-lived execution assumptions
- plugin/server contributions include provisioning concerns

Use when:

- the user workflow depends on seeded workspace content or runtime setup
- the agent environment is part of the product

Default choices:

- base app: `apps/full-app`
- provisioning location: trusted app/server/plugin composition
- verification: include runtime/provisioning acceptance checks

## Quick chooser

| If the app mainly needs... | Archetype |
|---|---|
| branding + deploy | Thin branded shell |
| custom panels/tools in workbench | Plugin-heavy workspace app |
| real business/domain backend | Domain-backed app |
| templated workspace/runtime setup | Provisioned runtime app |

## Rule

A serious child app can combine archetypes.

Example combination:

- branded shell
- plugin-heavy workspace app
- domain-backed app

When that happens, say so explicitly before implementation.
