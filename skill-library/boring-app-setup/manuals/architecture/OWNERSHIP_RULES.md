# Boring App Setup — Ownership Rules

Use this file to decide **where code should live**.

## Core owns

Put it in core only if it is genuinely generic across child apps:

- auth/session/account flows
- workspace membership/invites/settings
- generic app shell behavior
- generic config/env handling

Child apps should usually **consume** core, not edit it.

## App shell owns

Put it in the child app when it is app identity or app composition:

- branding
- app title / README / package identity
- deploy target files
- env templates
- app-specific route composition
- app-specific plugin registration
- app-specific server boot choices

## Trusted server plugin owns

Use a trusted app/internal server plugin when the behavior is tied to a workspace/plugin surface and needs boot-time trusted integration:

- app-specific agent tools
- app-specific plugin routes
- plugin-owned provisioning contributions
- plugin-specific prompt/resources

## Front plugin owns

Use a front plugin when the behavior is a workspace surface:

- panels
- commands
- catalogs
- left tabs
- surface resolvers
- providers/bindings tied to that plugin surface

## App server module owns

Keep logic in normal app/server modules when it is broader product/backend logic and not naturally a plugin contribution:

- app-wide domain services
- cross-plugin orchestration
- backend integrations not tied to one workspace surface
- product routes outside plugin composition

## Shared layer owns

Use app-local shared code for:

- shared types/constants used by front and server
- browser-safe contracts

Do not put Node-only code in shared browser-safe areas.

## Quick rule

Ask:

1. is this generic across child apps? → core
2. is this app identity/composition? → app shell
3. is this a workspace/plugin surface? → plugin
4. is this app domain/backend logic not naturally a plugin? → app server module

## Anti-patterns

Avoid:

- putting child-app logic into core just because core already exists
- putting broad backend domain services inside a tiny panel file
- using a plugin just to avoid naming an app/server module
- inventing extra abstraction layers before the app needs them
