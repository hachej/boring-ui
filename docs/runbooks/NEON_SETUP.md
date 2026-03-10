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

**Important**: Use the `-pooler` hostname in `DATABASE_URL` for Modal (connection pooling). The free tier has 100 connection limit. For session interop with boring-sandbox, set the same `BORING_UI_SESSION_SECRET` in `boring-sandbox-secrets`.

## Child Project Setup

For new projects (boring-macro, boring-sandbox, etc.) that need their own Neon database:

1. Create a separate Neon project (free tier allows 20)
2. Run the relevant schema
3. To share auth with boring-ui: use the same `BORING_UI_SESSION_SECRET` for session cookie interop
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
- boring-ui uses its own `boring_session` cookie — the Neon cookie is only for JWT fetch

**Token exchange returns 401 "TOKEN_INVALID"**
- The `token` field from `/sign-in/email` is an opaque session ID, NOT a JWT
- Frontend must call Neon Auth `/token` endpoint (with `credentials: 'include'`) to get the EdDSA JWT
- The JWT is then sent to boring-ui `/auth/token-exchange` for JWKS verification
- Check that `NEON_AUTH_JWKS_URL` is reachable from the backend
