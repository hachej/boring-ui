# DB

Status: **planned** — schema ports v1; no migrations have been run in v2 yet.

## Stack

- **[Drizzle ORM](https://orm.drizzle.team)** — schema, query builder, migration generation.
- **`postgres`** (porsager) — Postgres driver.
- **Postgres** — only supported dialect in v1. SQLite is a v1.x concern.

## Schema overview

Tables split across two owners:

**better-auth-owned** (DO NOT edit directly; better-auth's schema generator manages these):

- `users` — `id` (uuid), `email`, `name`, `emailVerified`, `image`, `createdAt`, `updatedAt`.
- `sessions` — session records with rotation.
- `accounts` — linked OAuth accounts.
- `verification_tokens` — email-verification / magic-link tokens (not used in v1 but reserved).

**Core-owned** (ported from v1 `@boring/cloud/db/schema.ts`):

- `workspaces` — `id`, `appId`, `name`, `createdBy`, `createdAt`, `deletedAt`, `isDefault`, `machineId`, `volumeId`, `flyRegion`.
- `workspaceMembers` — `(workspaceId, userId)` composite pk, `role` (`owner` | `editor` | `viewer`), `createdAt`.
- `workspaceInvites` — `id`, `workspaceId`, `email`, `tokenHash`, `role`, `expiresAt`, `acceptedAt`, `createdBy`.
- `workspaceSettings` — `(workspaceId, key)` composite pk, `value` (bytea, pgcrypto-encrypted), `updatedAt`.
- `workspaceRuntimes` — `workspaceId` pk, `spriteUrl`, `spriteName`, `state`, `lastError`, `updatedAt`, `provisioningStep`, `stepStartedAt`. Written by agent package when it provisions. Full v1 column list ported.
- `userSettings` — `(userId, appId)` composite pk, `settings` jsonb, `email`, `displayName`, `updatedAt`.

Foreign keys:

- `workspaceMembers.workspaceId → workspaces.id` **(ported from v1)**
- `workspaceInvites.workspaceId → workspaces.id` **(ported from v1)**
- `workspaceSettings.workspaceId → workspaces.id` **(ported from v1)**
- `workspaceRuntimes.workspaceId → workspaces.id` **(ported from v1)**
- `workspaceMembers.userId → users.id` **(NEW in v2** — v1 couldn't have this because Neon Auth owned users externally)
- `workspaceInvites.createdBy → users.id` **(NEW in v2)**
- `userSettings.userId → users.id` **(NEW in v2)**

## Stores

All persistence goes through one of two interfaces. Route handlers import the interface, not the implementation.

### `UserStore`

```ts
export interface UserStore {
  getById(id: string): Promise<User | null>
  getByEmail(email: string): Promise<User | null>
  upsert(userId: string, data: { email: string; name?: string }): Promise<User>
  getSettings(userId: string): Promise<Record<string, unknown>>
  putSettings(userId: string, settings: Record<string, unknown>): Promise<void>
}
```

Implementations:

- `PostgresUserStore` — Drizzle + postgres.
- `LocalUserStore` — in-memory Map. Tests + CLI zero-setup.

### `WorkspaceStore`

```ts
export interface WorkspaceStore {
  // Workspace CRUD
  create(userId: string, name: string, appId: string): Promise<Workspace>
  list(userId: string): Promise<Workspace[]>
  get(id: string): Promise<Workspace | null>
  update(id: string, updates: Partial<Pick<Workspace, 'name'>>): Promise<Workspace | null>
  delete(id: string): Promise<boolean>

  // Membership
  isMember(workspaceId: string, userId: string): Promise<boolean>
  getMemberRole(workspaceId: string, userId: string): Promise<MemberRole | null>
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>
  upsertMember(workspaceId: string, userId: string, role: MemberRole): Promise<WorkspaceMember>
  removeMember(workspaceId: string, userId: string): Promise<{ removed: boolean; code?: string }>

  // Invites
  listInvites(workspaceId: string): Promise<WorkspaceInvite[]>
  createInvite(workspaceId: string, email: string, role: MemberRole, invitedBy: string | null): Promise<WorkspaceInvite>
  getInvite(workspaceId: string, inviteId: string): Promise<WorkspaceInvite | null>
  revokeInvite(workspaceId: string, inviteId: string): Promise<boolean>
  acceptInvite(workspaceId: string, inviteId: string, userId: string): Promise<{ invite?: WorkspaceInvite; member?: WorkspaceMember }>

  // Settings
  getUserSettings(userId: string, appId: string): Promise<{ display_name: string; settings: Record<string, unknown> }>
  putUserSettings(userId: string, appId: string, updates: { display_name?: string; settings?: Record<string, unknown> }): Promise<{ display_name: string; settings: Record<string, unknown> }>
  getWorkspaceSettings(workspaceId: string): Promise<Record<string, string>>
  putWorkspaceSettings(workspaceId: string, settings: Record<string, string>): Promise<Record<string, string>>

  // UI state persistence (optional hook for workspace package)
  getUiState(userId: string, workspaceId: string): Promise<Record<string, unknown> | null>
  putUiState(userId: string, workspaceId: string, state: Record<string, unknown>): Promise<void>
}
```

Implementations:

- `PostgresWorkspaceStore` — Drizzle + pgcrypto for encrypted settings.
- `LocalWorkspaceStore` — in-memory.

## Migrations

```bash
# Generate SQL from schema changes
pnpm drizzle-kit generate --config node_modules/@boring/core/drizzle.config.ts

# Apply to DATABASE_URL
pnpm drizzle-kit migrate --config node_modules/@boring/core/drizzle.config.ts
```

Core ships its own `drizzle.config.ts` pointing at its schema. Migration SQL lives in `packages/core/drizzle/`.

**Important**: child apps with their own tables run their own `drizzle-kit` against their own config. Core never touches tables it doesn't own.

## Encrypted settings

`workspaceSettings.value` is stored as `bytea` and encrypted/decrypted with `pgcrypto` at query time, same as v1. The encryption key comes from `WORKSPACE_SETTINGS_ENCRYPTION_KEY` env var (32-byte hex).

```sql
-- Insert
INSERT INTO workspace_settings (workspace_id, key, value)
VALUES ($1, $2, pgp_sym_encrypt($3, $4))

-- Select
SELECT key, pgp_sym_decrypt(value, $1)::text AS value
FROM workspace_settings
WHERE workspace_id = $2
```

## Local mode

`CORE_STORES=local` skips Postgres entirely. `createCoreApp` wires `LocalUserStore` + `LocalWorkspaceStore` in memory. State vanishes on restart. Only supported for tests and the agent CLI's zero-setup path.

## Not in v1

- SQLite / libsql dialect (v1.x — the stores already abstract the SQL, so adding a second Drizzle dialect is bounded work).
- Audit log table.
- Soft-delete for users (better-auth owns users; hard-delete for now).
- Per-workspace API keys.
- Multi-region / read-replica awareness.
