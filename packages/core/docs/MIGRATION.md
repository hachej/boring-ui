# Migration from v1

How v2 `@boring/core` differs from v1 `@boring/core` + `@boring/cloud`, and what child apps need to change.

Status: **planned** — this doc will firm up as implementation lands and we migrate the first child app.

## High-level changes

| Concern | v1 | v2 |
|---|---|---|
| Package split | `@boring/core` (OSS) + `@boring/cloud` (private) | **One** `@boring/core` (combined) |
| Dependency order | `core ← workspace ← agent ← cloud` | `workspace ← core ← agent` |
| UI primitives | Vendored in `@boring/core/front/design-system` | Live in `@boring/workspace/ui-shadcn`; core imports from there |
| Auth | Hand-rolled `AuthProvider` + `LocalAuthProvider` / `NeonAuthProvider` | **better-auth** (email/pw + GitHub OAuth), `AuthProvider` interface kept as swap seam |
| Control plane branching | `controlPlaneProvider: 'local' \| 'neon'` in config + runtime branching | **Removed** — Postgres is the only supported stack; local = in-memory stores (tests/CLI) |
| DB | Drizzle + Postgres (Neon), schema in `@boring/cloud/db` | Drizzle + Postgres, schema moved into `@boring/core/server/db` |
| Frontend shell | Providers exported individually; child app wires them | **`<BoringApp>`** single wrapper with react-router mounted |
| Router | No router in core; each app picks | react-router v6 mounted inside `<BoringApp>` with route slot |
| Sign-in page | Lived in `@boring/cloud/front/AuthPage` | Lives in `@boring/core/front/SignInPage` |

## Removed APIs

Gone. No compat shim.

- `@boring/cloud/server/NeonAuthProvider` — better-auth replaces. For Neon Auth specifically, write a `NeonAuthProvider implements AuthProvider` yourself and pass to `createCoreApp`.
- `@boring/cloud/server/http/registerAuthRoutes` — better-auth's own Fastify plugin handles `/auth/*`.
- `@boring/cloud/server/http/registerGitHubRoutes` — GitHub App install flow re-owned by `@boring/agent` when/if agent needs per-workspace git ops. Not in core.
- `@boring/core/server/runtimeConfig.ts` control-plane branching — config is flat now.
- `@boring/core/server/capabilities/pythonCompat.ts` — no Python server in v2.
- `@boring/core/server/providers/local/LocalAuthProvider` — better-auth covers local dev.

## Renames

| v1 | v2 |
|---|---|
| `@boring/core/front/design-system/ui/*` | `@boring/workspace/ui-shadcn/*` |
| `@boring/core/front/UserIdentityContext` | `@boring/core/front/UserIdentityProvider` (exported alongside `useUser()`) |
| `@boring/cloud/front/AuthPage` | `@boring/core/front/SignInPage` + `SignUpPage` |
| `@boring/cloud/server/db/*` | `@boring/core/server/db/*` |
| `@boring/cloud/server/providers/*` (PostgresUserStore, PostgresWorkspaceStore) | `@boring/core/server/*` |
| `registerCoreRoutes({ auth, userStore, workspaceStore })` | `createCoreApp(config)` — wiring is internal |

## New APIs

- `createCoreApp(config)` — one function replacing the v1 "register-a-handful-of-plugins-in-the-right-order" boilerplate.
- `<BoringApp>` — one wrapper replacing the v1 provider pyramid.
- `useSession`, `signIn`, `signOut` — better-auth React client.
- `useCurrentWorkspace`, `useWorkspaceRole`, `useWorkspaceMembers` — workspace-aware hooks.

## Migration steps for a v1 app

1. **Replace two deps with one.** `@boring/core` + `@boring/cloud` → `@boring/core`. Remove `@boring/cloud` from package.json.
2. **Update imports.** Wherever you imported from `@boring/cloud/server`, change to `@boring/core/server`. Wherever you imported from `@boring/core/front/design-system/ui`, change to `@boring/workspace/ui-shadcn`.
3. **Replace server boot.** Delete the hand-wired Fastify registration of `authHook`, `requestIdHook`, `secretRedaction`, `registerCoreRoutes`, `registerAuthRoutes`, `registerCollaborationRoutes`. Replace with `const app = await createCoreApp(config)`. Register your app-specific routes after.
4. **Replace frontend shell.** Delete the hand-wired `<ConfigProvider><ThemeProvider>…</>` pyramid in `main.tsx`. Replace with `<BoringApp>{routes}</BoringApp>`.
5. **Config cleanup.** Remove `controlPlaneProvider` branching and any `if (config.controlPlaneProvider === 'neon')` guards. Postgres-only.
6. **Auth migration.** If you were on Neon Auth:
   - Export your user data (`neon_auth.users`) and import into v2's `users` table (better-auth-owned) via a one-shot SQL script.
   - Users will sign in again once; sessions don't carry over.
   - Alternative: write a `NeonAuthProvider implements AuthProvider` in your app and keep existing Neon tokens.
7. **Run migrations.** `drizzle-kit migrate` against core's config. Core migrations are idempotent on the existing v1 tables (same column names).
8. **Delete `AuthPage.tsx`.** Core ships `<SignInPage>` / `<SignUpPage>`. If you had branding, pass overrides: `<BoringApp authPages={{ signIn: MyAuthPage }}>`.
9. **Switch router.** If you were using react-router directly in `main.tsx`, remove `<BrowserRouter>` — `<BoringApp>` mounts it. Move your `<Route>` definitions to `children` of `<BoringApp>`.
10. **Verify.** `pnpm typecheck && test` in your app. E2E: sign up → create workspace → invite → accept.

## Database migration

v1 → v2 schema is additive:

- Adds better-auth tables (`users`, `sessions`, `accounts`, `verification_tokens`).
- Keeps v1 tables (`workspaces`, `workspace_members`, `workspace_invites`, `workspace_settings`, `user_settings`) unchanged.

If you had Neon Auth users in `neon_auth.users`, you need a one-shot ETL. **The SQL below is a sketch — final column names depend on better-auth's generated `users` schema, which isn't finalized until M1 lands.** Treat as pseudocode; validate against the actual generated schema before running.

```sql
-- SKETCH — column list to be finalized against better-auth's generated schema.
INSERT INTO users (id, email, name, email_verified, created_at)
SELECT id, email, name, true, created_at
FROM neon_auth.users
ON CONFLICT (id) DO NOTHING;
```

**UserId continuity is load-bearing**: `workspace_members.user_id`, `workspace_invites.created_by`, `user_settings.user_id` all reference `users.id`. The ETL above preserves IDs 1:1 so existing memberships and invites keep working. If you rename or regenerate IDs, you must migrate those tables in the same transaction.

After ETL, better-auth owns users. Users sign in again once (password reset flow if email/pw; re-click "Sign in with GitHub" if OAuth). Sessions do not carry over.

## Rollback

v2 is a hard cut — no coexistence with v1 in the same app. To roll back, restore the v1 app from git and restore the Neon DB from a pre-migration snapshot. The new better-auth tables (`sessions`, `accounts`, `verification_tokens`) can be dropped cleanly; `users` is trickier if you kept the same DB.

Recommendation: migrate a staging DB copy first.
