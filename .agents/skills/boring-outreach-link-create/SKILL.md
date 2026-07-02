---
name: boring-outreach-link-create
description: Create boring-ui cold outreach URLs with anonymous auto-auth, scoped demo workspace access, and optional initial credit balance. Use when asked to create an invitation/outreach/demo link, cold outreach URL, token URL, anonymous lead link, or predefined trial credits.
---

# Boring Outreach Link Create

Use this skill when a user wants a programmatic URL that lets a cold outreach recipient open a boring-ui app without signup, receive anonymous scoped access, and optionally start with a predefined credit balance.

## What exists

Outreach links live in `@hachej/boring-core` so child apps that compose core inherit the feature.

Core routes:

- `POST /api/v1/outreach/experiences` — create the demo/provisioning spec.
- `POST /api/v1/outreach-links` — create a token URL for that experience.
- `GET /o/:token` — consume token, create anonymous lead session, provision access, redirect.

Admin creation is fail-closed. The signed-in creator email must be listed in:

```bash
BORING_OUTREACH_ADMIN_EMAILS=founder@example.com,ops@example.com
```

## Safety rules

- Never put Better Auth session tokens or API keys in URLs.
- Never log raw outreach URLs in public comments or shared logs.
- Treat the raw `/o/<token>` URL as secret; core stores only its HMAC hash.
- Set `maxLeads: 1` for one-recipient links unless explicitly creating a campaign link.
- Use short TTLs for cold outreach, e.g. `ttlHours: 720` for 30 days.
- Use `initialCreditMicros` only for trial budget. Amounts are credit micros.

Credit amount examples:

```txt
1_000_000  = 1 credit unit / about €1 equivalent under default pricing
5_000_000  = 5
10_000_000 = 10
```

## Programmatic API flow

### 1. Create or choose a template workspace

The MVP provisioner supports shared/existing workspace viewer access.
Use an existing demo workspace ID as `templateWorkspaceId`.

### 2. Create an outreach experience

```bash
curl -sS -X POST "$APP_URL/api/v1/outreach/experiences" \
  -H "content-type: application/json" \
  -H "cookie: $ADMIN_COOKIE" \
  --data @- <<'JSON'
{
  "name": "Acme CRM demo",
  "provisioningMode": "shared_readonly",
  "templateWorkspaceId": "00000000-0000-0000-0000-000000000000",
  "defaultTargetPath": "/workspace/{workspaceId}",
  "anonymousCapabilityProfile": "trial"
}
JSON
```

Save `experience.id` from the response.

### 3. Create the token URL with predefined credits

```bash
curl -sS -X POST "$APP_URL/api/v1/outreach-links" \
  -H "content-type: application/json" \
  -H "cookie: $ADMIN_COOKIE" \
  --data @- <<'JSON'
{
  "experienceId": "EXPERIENCE_ID_FROM_STEP_2",
  "campaignId": "cold-outreach-june",
  "recipientHint": "acme-founder",
  "ttlHours": 720,
  "maxLeads": 1,
  "initialCreditMicros": 5000000
}
JSON
```

The response contains:

```json
{
  "link": {
    "id": "...",
    "url": "https://app.example.com/o/<raw-token>",
    "expiresAt": "..."
  }
}
```

Send `link.url` to the recipient.

## TypeScript shape

Inside server code that already has `db`, `config`, and current admin user:

```ts
import {
  createOutreachExperience,
  createOutreachLink,
} from '@hachej/boring-core/server'

const experience = await createOutreachExperience({
  db,
  appId: config.appId,
  name: 'Acme CRM demo',
  provisioningMode: 'shared_readonly',
  templateWorkspaceId,
  defaultTargetPath: '/workspace/{workspaceId}',
  anonymousCapabilityProfile: 'trial',
  createdBy: adminUserId,
})

const link = await createOutreachLink({
  db,
  appId: config.appId,
  authSecret: config.auth.secret,
  authUrl: config.auth.url,
  experienceId: experience.id,
  ttlHours: 720,
  maxLeads: 1,
  initialCreditMicros: 5_000_000,
  recipientHint: 'acme-founder',
  createdBy: adminUserId,
})
```

## Runtime behavior

When the recipient opens the URL:

1. Core validates the token before creating an anonymous user.
2. Core creates or resumes an anonymous outreach lead.
3. Core grants `initialCreditMicros` once per user/link with reason:
   `outreach:<linkId>:initial_credit`.
4. Core grants viewer access to the configured demo workspace.
5. Browser receives a normal Better Auth session cookie and redirects to `defaultTargetPath`.

## Troubleshooting

- `403 Outreach administration requires BORING_OUTREACH_ADMIN_EMAILS`: set the env var and sign in as an allowlisted admin.
- `404 Outreach link is invalid or expired`: token is wrong, revoked, expired, or capacity is exhausted.
- Recipient sees signed-in conflict page: they already have a non-anonymous account session; ask them to use a private window or sign out.
- No credits appear: confirm `initialCreditMicros > 0` and that credit/metering tables are migrated.

## Completion checklist

- [ ] `BORING_OUTREACH_ADMIN_EMAILS` configured.
- [ ] Demo workspace exists and belongs to this app.
- [ ] Experience created with safe internal `defaultTargetPath`.
- [ ] Link created with `maxLeads`, `ttlHours`, and optional `initialCreditMicros`.
- [ ] Raw URL delivered privately; not committed or posted publicly.
