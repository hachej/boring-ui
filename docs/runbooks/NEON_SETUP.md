# Neon Setup Runbook

How to set up Neon Postgres + Neon Auth for boring-ui and child projects.

## Prerequisites

- Neon account (https://neon.tech — GitHub OAuth)
- `neonctl` CLI: `npm install -g neonctl`
- Neon API key from Account Settings → API Keys

## 1. Create Project

```bash
export NEON_API_KEY=<your-api-key>

# Create project (eu-central-1 for low latency)
neonctl projects create --name <project-name> --region-id aws-eu-central-1 --output json
```

Save from output:
- `connection_uri` (direct)
- `pooler_host` (for production — add `-pooler` to endpoint hostname)

## 2. Enable pgcrypto

```bash
psql "$DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'
```

Verify:
```sql
SELECT pgp_sym_encrypt('test', 'key');  -- should return bytea
SELECT gen_random_uuid();                -- should return uuid
```

## 3. Run Schema

```bash
psql "$DATABASE_URL" -f deploy/sql/control_plane_supabase_schema.sql
```

The schema is standard Postgres — no Supabase-specific functions.

## 4. Enable Neon Auth

```bash
# Get branch ID
BRANCH_ID=$(neonctl branches list --project-id <project-id> --output json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")

# Enable auth
curl -X POST "https://console.neon.tech/api/v2/projects/<project-id>/branches/$BRANCH_ID/auth" \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"auth_provider": "better_auth"}'
```

**Save the response immediately** — `pub_client_key` and `secret_server_key` are only shown once.

Response contains:
- `base_url` — auth API endpoint
- `jwks_url` — for JWT verification

## 5. Configure Environment

```bash
# .env or Modal secrets
CONTROL_PLANE_PROVIDER=neon
DATABASE_URL=postgresql://neondb_owner:<pass>@ep-<id>-pooler.<region>.aws.neon.tech/neondb?sslmode=require
NEON_AUTH_BASE_URL=https://ep-<id>.neonauth.<region>.aws.neon.tech/neondb/auth
NEON_AUTH_JWKS_URL=https://ep-<id>.neonauth.<region>.aws.neon.tech/neondb/auth/.well-known/jwks.json
BORING_SETTINGS_KEY=<32-byte-key>
BORING_UI_SESSION_SECRET=<session-secret>
```

**Important**: Use the `-pooler` hostname in `DATABASE_URL` for production (connection pooling). Free tier has 100 connection limit.

## 6. Verify Auth

```bash
BASE_URL=<your-neon-auth-base-url>

# Signup
curl -X POST "$BASE_URL/sign-up/email" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d '{"email":"test@test.com","password":"TestPass123!","name":"Test"}'

# Signin
curl -X POST "$BASE_URL/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d '{"email":"test@test.com","password":"TestPass123!"}'

# JWKS
curl "$BASE_URL/.well-known/jwks.json"
```

## Neon Auth API Reference

| Endpoint | Method | Body | Returns |
|---|---|---|---|
| `/sign-up/email` | POST | `{email, password, name}` | `{token, user}` + session cookie |
| `/sign-in/email` | POST | `{email, password}` | `{token, user}` + session cookie |
| `/get-session` | GET | (session cookie) | `{session, user}` |
| `/token` | GET | (session cookie) | `{token: "JWT..."}` |
| `/.well-known/jwks.json` | GET | — | Ed25519 public key |
| `/ok` | GET | — | `{ok: true}` |

All POST endpoints require `Origin` header.

**Important**: The `token` field in sign-up/sign-in responses is an opaque session ID, not a JWT. Use `/token` to get the JWT.

JWT claims: `{sub, id, email, name, role, exp, iss, aud, iat, emailVerified}`
JWT algorithm: EdDSA (Ed25519)
JWT audience: Neon Auth origin URL (e.g., `https://ep-<id>.neonauth.<region>.aws.neon.tech`)

### Email Verification Behavior (Neon / Better Auth)

- Neon Auth (Better Auth) does not send verification emails by default.
- `emailVerified: false` in the returned user/JWT payload is expected unless you configure an email sender.
- If you need verification emails, configure a custom email provider on Neon.
- For boringdata child apps, use the `boring-ui` email sender provider via `boringdatasetup` instead of per-app ad hoc email sender setup.
- In boring-ui, Neon signup is verify-first:
  - `POST /auth/sign-up` creates the account and returns `requires_email_verification: true`
  - the verification link comes back to `/auth/callback?redirect_uri=/w/<workspace_id>/...`
  - boring-ui completes the follow-up Neon sign-in on the backend
  - the user is then redirected directly into the requested workspace path

### boring-ui Neon Endpoints

Prefer boring-ui's same-origin auth endpoints over calling Neon Auth directly from the browser:

| boring-ui endpoint | Purpose |
|---|---|
| `POST /auth/sign-in` | Email/password sign-in through the boring-ui backend |
| `POST /auth/sign-up` | Verify-first account creation through the boring-ui backend |
| `GET /auth/callback` | Email verification landing that completes sign-in and redirects |
| `POST /auth/token-exchange` | JWT-to-`boring_session` compatibility / fallback exchange |

This keeps local dev origins out of the critical auth path and makes workspace redirect handling explicit.

## Modal Deployment

After completing steps 1-5, deploy to Modal:

```bash
# 1. Create Modal secret with Neon credentials
modal secret create boring-ui-core-secrets \
  CONTROL_PLANE_PROVIDER=neon \
  DATABASE_URL="$DATABASE_URL" \
  NEON_AUTH_BASE_URL="$NEON_AUTH_BASE_URL" \
  NEON_AUTH_JWKS_URL="$NEON_AUTH_JWKS_URL" \
  BORING_UI_SESSION_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')" \
  BORING_SETTINGS_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(32))')" \
  --force

# 2. Build frontend
npm run build

# 3. Deploy
modal deploy deploy/core/modal_app.py    # core mode
modal deploy deploy/edge/modal_app.py    # edge mode (optional)

# 4. Verify
curl -s https://<your-app>.modal.run/api/capabilities | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin).get('auth',{}), indent=2))"
```

**Important**: Use the `-pooler` hostname in `DATABASE_URL` for Modal (connection pooling). The free tier has 100 connection limit.

## Session Persistence Across Deploys

By default, if `BORING_UI_SESSION_SECRET` is not set, boring-ui generates an ephemeral random secret on startup. This means **every redeploy invalidates all existing session cookies**, forcing users to re-login.

To fix this, set a stable `BORING_UI_SESSION_SECRET` in your Modal secret:

```bash
# Generate a stable secret (run once, save the output)
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'

# Set it in boring-ui-core-secrets (include all existing keys)
modal secret create boring-ui-core-secrets \
  CONTROL_PLANE_PROVIDER=neon \
  DATABASE_URL="<your-pooler-url>" \
  NEON_AUTH_BASE_URL="<your-neon-auth-url>" \
  NEON_AUTH_JWKS_URL="<your-jwks-url>" \
  BORING_UI_SESSION_SECRET="<the-stable-secret>" \
  BORING_SETTINGS_KEY="<your-settings-key>" \
  --force
```

**Warning**: `modal secret create --force` overwrites ALL keys. Always include every key when recreating.

## Child App Session Interop

boring-ui session cookies (`boring_session`) are HS256 JWTs. Any child app (boring-macro, boring-sandbox, etc.) that needs to validate these cookies must share the same signing secret.

### What child apps need

| Setting | boring-ui env var | Child app env var | Where to set |
|---|---|---|---|
| Session secret | `BORING_UI_SESSION_SECRET` | `BORING_SESSION_SECRET` | Modal secret for the child app |
| Cookie name | `AUTH_SESSION_COOKIE_NAME` (default: `boring_session`) | Must match | Hardcoded or env var |

### Setup steps for a child app

1. **Use the same session secret** as boring-ui. Copy the value of `BORING_UI_SESSION_SECRET` from `boring-ui-core-secrets` into the child app's Modal secret as `BORING_SESSION_SECRET`:

   ```bash
   # Example: boring-sandbox
   modal secret create boring-sandbox-secrets \
     BORING_SESSION_SECRET="<same-secret-as-boring-ui>" \
     VAULT_ADDR="<vault-addr>" \
     VAULT_TOKEN="<vault-token>" \
     --force
   ```

2. **Validate the cookie** in the child app. The JWT payload contains:

   ```json
   {
     "sub": "<user-id>",
     "email": "<user-email>",
     "iat": 1710000000,
     "exp": 1710086400,
     "app_id": "boring-ui"
   }
   ```

   Validate with PyJWT:
   ```python
   import jwt
   payload = jwt.decode(token, secret, algorithms=["HS256"])
   user_id = payload["sub"]
   ```

3. **Do NOT issue session cookies** from the child app. Only boring-ui issues `boring_session` cookies. Child apps are consumers/validators only.

4. **Check `app_id`** if the child app requires it. boring-sandbox rejects sessions without a matching `app_id` when an app is resolved. Set `CONTROL_PLANE_APP_ID` in boring-ui to match what the child expects.

5. **Use boring-ui email sender wiring for verification flows**. If a child app needs signup email verification, route it through the `boring-ui` email sender provider configured by `boringdatasetup`.

### Checklist

- [ ] Same secret value in both `boring-ui-core-secrets` (`BORING_UI_SESSION_SECRET`) and child secret (`BORING_SESSION_SECRET`)
- [ ] Child app reads cookie named `boring_session` (or the configured `AUTH_SESSION_COOKIE_NAME`)
- [ ] Child app validates HS256 JWT with the shared secret
- [ ] Child app does NOT issue its own session cookies
- [ ] Secrets updated together when rotated — rotate boring-ui first, then all child apps

## Child Project Database Setup

For new projects (boring-macro, boring-sandbox, etc.) that need their own Neon database:

1. Create a separate Neon project (free tier allows 20)
2. Run the relevant schema
3. Share auth with boring-ui via the session secret (see above)
4. Each project gets its own `DATABASE_URL` but can share the auth provider

## Neon Free Tier Limits

- 20 projects
- 0.5 GB storage per project
- 100 compute-hours/month
- 100 connections per endpoint
- Auto-suspend after 5 min idle (4-10s cold start)
- Mitigate cold starts: health-check ping via cron or upgrade to paid plan

## Troubleshooting

**"connection refused" from Modal**
- Neon requires SSL: ensure `?sslmode=require` in connection string
- Check if compute is suspended (first request after idle has cold start)

**"EdDSA algorithm not supported"**
- Pin `PyJWT[crypto]>=2.8.0` in pyproject.toml
- Verify `cryptography` package includes Ed25519 support

**Auth returns 400 "MISSING_ORIGIN"**
- All auth POST requests need `Origin` header matching a trusted domain

**Session cookie not set (cross-domain)**
- Neon Auth sets `__Secure-neon-auth.session_token` with `SameSite=None; Partitioned`
- boring-ui uses its own `boring_session` cookie
- verify-email flows should normally complete on the backend and redirect straight into the workspace
- the Neon cookie is still relevant for compatibility paths that fetch `/token`

**Token exchange returns 401 "TOKEN_INVALID"**
- The `token` field from `/sign-in/email` is an opaque session ID, NOT a JWT
- Compatibility path: fetch Neon Auth `/token` endpoint (with `credentials: 'include'`) to get the EdDSA JWT
- The JWT is then sent to boring-ui `/auth/token-exchange` for JWKS verification
- Check that `NEON_AUTH_JWKS_URL` is reachable from the backend
