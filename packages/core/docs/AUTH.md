# Auth

Status: **planned** — better-auth is locked as the v1 provider; interface shim is planned for later swap-outs.

## v1 shape

- **[better-auth](https://www.better-auth.com)** — email/password + GitHub OAuth.
- **Drizzle adapter** against the same Postgres instance core uses.
- Tables owned by better-auth: `users`, `sessions`, `accounts`, `verification_tokens`.
- Session = signed HTTP-only cookie; auto-rotated by better-auth.
- `AuthProvider` interface (ported from v1) wraps better-auth so future swaps (Neon Auth, Clerk, WorkOS) don't touch route handlers.

## Why better-auth over v1's hand-rolled AuthProvider

v1 shipped `LocalAuthProvider` (JWT cookie, email/password) + `NeonAuthProvider` (Neon's Better Auth JWT verification). Adding Google or a magic-link flow meant writing it ourselves.

| Capability | v1 (hand-rolled) | v2 (better-auth) |
|---|---|---|
| Email + password | yes | yes |
| Session rotation | no | yes |
| GitHub OAuth | ~1 week | ~1 hour |
| Google/Apple/Discord | ~1 week each | ~1 hour each |
| Magic links | not implemented | one config flag |
| Email verification | not implemented | one config flag |
| Password reset | not implemented | one config flag |
| 2FA (TOTP) | not implemented | plugin |
| React hooks | `useWorkspaceAuth` only | `useSession`, `signIn`, `signOut` |
| Drizzle adapter | n/a | first-party |

## Wiring (planned)

```ts
// Internal to createCoreApp — you don't call this directly.
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

export function createAuth(config: CoreConfig, db: Database) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg' }),
    secret: config.auth.secret,
    baseURL: config.auth.url,
    emailAndPassword: { enabled: true },
    socialProviders: config.auth.github
      ? { github: {
            clientId: config.auth.github.clientId,
            clientSecret: config.auth.github.clientSecret,
          } }
      : {},
  })
}
```

Fastify mount:

```ts
// Internal to createCoreApp.
app.all('/auth/*', async (req, reply) => {
  const res = await auth.handler(req.raw)
  return reply.from(res)
})
```

## AuthProvider interface (swap seam)

```ts
export interface AuthProvider {
  verifySession(token: string): Promise<SessionPayload | null>
  issueSession(user: { id: string; email: string }): Promise<string>
  cookieName(): string
}

export class BetterAuthProvider implements AuthProvider { /* delegates */ }
```

Route handlers accept `AuthProvider`, not the better-auth instance. To swap:

```ts
import { createCoreApp } from '@boring/core/server'
import { MyNeonAuthProvider } from './my-neon-auth'

const app = await createCoreApp(config, {
  authProvider: new MyNeonAuthProvider(config),
})
```

## `authHook` — Fastify auth middleware

```ts
app.register(authHook, {
  public: [/^\/auth\//, /^\/health$/, /^\/api\/v1\/config$/],
})
```

Attaches `request.user` (type `User | null`) to every request. Returns 401 for non-public `/api/v1/*` paths if no valid session.

## `requireWorkspaceMember` — per-route guard

```ts
app.get(
  '/api/v1/workspaces/:id/secrets',
  { preHandler: requireWorkspaceMember('editor') },
  async (req) => { /* ... */ },
)
```

Reads `:id` from params, checks the user's role against `WorkspaceStore.getMemberRole()`, 403s if insufficient.

Role hierarchy: `owner > editor > viewer`. Passing `'editor'` accepts `editor` and `owner`.

## React client

```tsx
import { useSession, signIn, signOut } from '@boring/core/front'

function Header() {
  const { data: session, isPending } = useSession()
  if (isPending) return <Spinner />
  if (!session) return <button onClick={() => signIn()}>Sign in</button>
  return <UserMenu user={session.user} onSignOut={signOut} />
}
```

`<AuthGate>` wraps the router and redirects unauthenticated users to `/auth/signin` for any non-public route.

## Sign-in / sign-up pages

Core ships `<SignInPage>` and `<SignUpPage>` styled with `@boring/workspace/ui-shadcn`. Override via:

```tsx
<BoringApp authPages={{ signIn: MyBrandedSignIn, signUp: MyBrandedSignUp }}>
  {/* ... */}
</BoringApp>
```

Your page components receive `{ onSubmit, oauthProviders, error }` props and can render whatever UI they want.

## Not in v1

- Google / Apple / Discord / other OAuth providers (one-line adds in `createAuth`, but unshipped).
- Magic links (turn on `emailAndPassword: { magicLink: true }` + configure mail transport).
- Email verification (turn on + configure mail).
- Password reset (same).
- 2FA / TOTP (better-auth plugin; deferred).
- Session revocation UI (`DELETE /api/v1/me/sessions/:id`).
- API keys (per-workspace tokens for headless access) — target v1.x.
