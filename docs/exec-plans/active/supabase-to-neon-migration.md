# Supabase → Neon Migration

Status: **complete**
Date: 2026-03-10
Why: Supabase = 2 free projects. Neon = 20. Neon Auth built-in.

## What actually needs to change

DB layer is already portable (asyncpg + raw SQL). Only real work is **auth swap**.

| Layer | Change needed? | Why |
|---|---|---|
| DB queries | NO | Standard Postgres, just change connection string |
| Auth frontend | **YES** | Supabase JS SDK → Neon Auth SDK |
| Auth backend | **YES** | GoTrue endpoints → Better Auth endpoints |
| JWT verification | **YES** | Different JWKS URL + possibly different signing alg |
| Session cookies | NO | Our own HS256 JWT, independent |
| Config/env vars | YES | Rename `SUPABASE_*` → `DATABASE_URL` + `NEON_AUTH_*` |
| Schema | YES | Strip `auth.uid()` if present, drop RLS |
| Deploy configs | YES | Update env var names in docker-compose, Modal secrets |

## Blockers (resolve first)

| # | Question | Result |
|---|---|---|
| B1 | Does Neon Auth support magic link or email OTP? | **No magic link.** Email/password only. Email OTP endpoint exists but not exposed in managed layer. Acceptable — simplifies auth flow. |
| B2 | What's the JWKS URL and JWT signing algorithm? | **EdDSA (Ed25519)**. JWKS at `{base}/.well-known/jwks.json`. JWT has `sub`, `email`, `exp`, `iss`, `role:"authenticated"`. |
| B3 | Does `pgcrypto` work on Neon? | **Yes.** `pgp_sym_encrypt()` and `gen_random_uuid()` both work. |
| B4 | Does Neon work from this VM? (IPv4/IPv6) | **Yes.** Direct connection works. Modal test pending. |
| B5 | Schema has `auth.uid()`? | **No.** Schema is pure standard Postgres. Deployed as-is to Neon successfully. |

## TDD Approach

Write tests FIRST for every component, against the current Supabase implementation. Once green, swap the implementation to Neon. Tests stay unchanged — green means migration succeeded.

### Test inventory (write before any code change)

**Backend unit tests** (`tests/unit/`):

| Test file | What it covers | Key assertions |
|---|---|---|
| `test_token_verify.py` | JWT verification | Accepts valid JWT (RS256, ES256, HS256); rejects expired; rejects bad signature; rejects missing `sub`/`exp`; handles JWKS fetch failure gracefully |
| `test_auth_session.py` | Session cookie create/parse | Round-trip create→parse; rejects expired cookie; rejects tampered cookie; handles `app_id` scoping; cookie settings (httponly, samesite, path) |
| `test_auth_router.py` | Auth endpoints | `POST /auth/token-exchange` with valid token → 200 + cookie set; with invalid token → 401; with missing token → 400; `GET /auth/logout` → clears cookie + redirects; `GET /auth/session` → returns session info or 401 |
| `test_capabilities.py` | Capabilities endpoint | Returns auth provider config; returns correct provider name; includes all required fields for frontend auth init |
| `test_db_client.py` | Connection pooling | Pooler detection (Neon `-pooler` suffix); SSL mode enforced; pool size within limits; IPv4 fallback logic |
| `test_workspace_router.py` | Workspace CRUD | Create → 201; list → returns user's workspaces; update name → 200; soft delete → 200; idempotent default workspace |
| `test_collaboration_router.py` | Invites + members | Create invite → 201; accept invite → member added; duplicate invite handling; role upgrade (never downgrade); list members sorted by role |
| `test_workspace_boundary.py` | Workspace scoping | Valid session + member → allowed; non-member → 403; deleted workspace → 404; session loading |
| `test_config.py` | Provider detection | `"neon"` → distinct code path; `DATABASE_URL` primary, `SUPABASE_DB_URL` fallback; auto-enable logic |

**Frontend tests** (`src/front/__tests__/`):

| Test file | What it covers |
|---|---|
| `AuthPage.test.jsx` | Renders login form; calls auth SDK on submit; handles rate-limit errors; extracts token from response; calls `/auth/token-exchange`; shows error messages; callback page extracts hash token |

**Integration / smoke tests** (`tests/smoke/`):

| Test | What it covers |
|---|---|
| `test_auth_e2e.py` | Full signup → login → session cookie → `/api/v1/me` → logout cycle |
| `test_workspace_e2e.py` | Create workspace → list → update → invite → accept → delete |
| `test_settings_e2e.py` | Upsert encrypted setting → verify stored → retrieve |

### Test-first workflow

1. **Write all tests above** against current Supabase implementation → all green
2. **Swap implementation** → tests go red where Supabase-specific
3. **Fix until green** → migration complete
4. Any test that can't go green reveals a real gap

## Steps

### 1. Spike (~half day)

Create Neon project. Enable auth. Run schema. Build tiny POC confirming signup/login/magic-link works with Neon Auth SDK + FastAPI JWT verification. This answers all blockers.

### 2. Write tests (~1 day)

Write the full test inventory above against the current Supabase implementation. Every test must pass. This is the safety net — if it's green on Supabase, it must be green on Neon when done.

### 3. Swap auth (~2 days)

**`AuthPage.jsx`** — Replace Supabase JS SDK with Neon Auth client:
- `signInWithPassword()` → `signIn.email()`
- `signUp()` → `signUp.email()`
- `signInWithOtp()` → `signIn.magicLink()` or `.emailOtp()`
- Update error/rate-limit detection

**`auth_router_supabase.py`** → `auth_router.py` — Replace GoTrue endpoints:
- `/auth/v1/token?grant_type=pkce` → Neon Auth session verification
- `/auth/v1/verify` → Better Auth verification
- Update login page config, callback bridge HTML

**`token_verify.py`** — Point JWKS at Neon's endpoint, update alg allow-list.

**`capabilities.py`** — Return Neon Auth config instead of `supabaseUrl`/`supabaseAnonKey`.

Run tests after each file change. Red → fix → green → next file.

### 4. Config + cleanup (~half day)

**`config.py`**:
- `SUPABASE_DB_URL` → `DATABASE_URL`
- `SUPABASE_URL` → `NEON_AUTH_URL`
- `SUPABASE_ANON_KEY` → remove or `NEON_AUTH_PUBLIC_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` → remove
- `SUPABASE_JWT_SECRET` → `AUTH_JWT_SECRET`
- Add `"neon"` provider value

**Deploy files** — update env vars in `.env.example`, `docker-compose.yml`, `modal_app.py`

**Schema** — strip `auth.uid()`, drop RLS policies

**Rename modules**:
- `supabase/` → `db/`
- `*_supabase.py` → drop suffix
- Update imports in `app.py`

**Smoke tests** — update `tests/smoke/smoke_lib/auth.py`

**`db_client.py`** — swap `.pooler.supabase.com` check for Neon pooler detection

## Files

| File | What changes |
|---|---|
| `AuthPage.jsx` | Auth SDK swap |
| `auth_router_supabase.py` | Rewrite → `auth_router.py` |
| `supabase/token_verify.py` | JWKS URL + alg |
| `capabilities.py` | Auth config |
| `config.py` | Env vars, provider |
| `supabase/db_client.py` | Pooler detection |
| `deploy/sql/control_plane_supabase_schema.sql` | Strip auth.uid(), drop RLS |
| `deploy/*/.env.example` | Env var names |
| `deploy/*/docker-compose.yml` | Env var names |
| `deploy/*/modal_app.py` | Secret names |
| `tests/smoke/smoke_lib/auth.py` | Auth API calls |
| `app.py` | Updated imports after renames |
| `auth_session.py` | **No change** |
| `workspace_router_supabase.py` | **Rename only** |
| `collaboration_router_supabase.py` | **Rename only** |
| `workspace_boundary_router_supabase.py` | **Rename only** |
| `me_router_supabase.py` | **Rename only** |
| `supabase/common.py` | **Rename only** |
| `supabase/membership.py` | **Rename only** |
