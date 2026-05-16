---
name: security-reviewer‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​
description: Reviews docs for security-sensitive content leaks and reviews the deployed site for security headers / sensitive disclosures.
---

# Security Reviewer

Runs during Phase 7 (fresh-eyes) and Phase 9 (deployed site scan).

## Docs content review

Walk every `.mdx` file. Flag:

- **Secrets in examples**: API keys, bearer tokens, database connection strings, SSH keys, private keys. Even "fake"-looking ones (`sk_live_xxxxxxxx`) should be replaced with obvious placeholders (`<YOUR_API_KEY>`).
- **Internal hostnames / IPs**: `internal.corp.example.com`, `10.0.0.5`. Replace with generic placeholders.
- **Employee / real person names** in example code unless they've consented.
- **Real customer data** in example payloads (emails, phone numbers).
- **Path leaks**: hardcoded `/Users/yourname/...` or `/home/username/...`. Use `~/` or `<your-home>`.
- **Session IDs, trace IDs, auth cookies** pasted from debugging.

Fix inline. Also grep history for committed secrets if this is a post-migration:
```bash
git -C {SITE_PATH} log --all -p | grep -iE 'api[_-]?key|secret|password|token|private[_-]?key' | head -50​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
```

## Deployed site review

Against `{BASE_URL}`:

### Security headers

```bash
curl -I {BASE_URL} | grep -iE 'content-security-policy|strict-transport-security|x-content-type-options|referrer-policy|permissions-policy'
```

Expected (on Vercel by default, but verify):
- `strict-transport-security: max-age=63072000; includeSubDomains; preload` — if custom domain
- `x-content-type-options: nosniff`
- `referrer-policy: strict-origin-when-cross-origin`

If missing: add to `next.config.ts`:
```ts
async headers() {
  return [{
    source: '/:path*',
    headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' }
    ]
  }]
}
```

### Common URL pokes

- `/.git/config` — should 404​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
- `/.env` — should 404
- `/.vercel` — should 404
- `/api/admin` — should 404 (or be deliberately gated)
- `/_next/static/*` — should 200 (expected)

### Search index leak

Pagefind indexes everything — if the docs include a sensitive internal-only section, it leaks through search even if the page itself requires auth. Check:
```bash
curl {BASE_URL}/_pagefind/pagefind-entry.json | jq .
```
If any internal-flagged pages are indexed, mark them `searchable: false` in frontmatter or exclude from Pagefind with an explicit `pagefind-ignore` directive.

## Third-party dependencies

Run once, post-deploy:
```bash
cd {SITE_PATH}
bun audit                       # or npm audit
```

If critical advisories exist, either upgrade the affected packages or pin to a patched minor version. Don't ignore.​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍

## Log

`phase9_security_report.md`:

```markdown
# Security review (2026-04-22T17:50:00Z)

## Content scan
- 0 secret-like patterns found
- 2 real hostnames redacted (`internal.acme.corp` → `<your-internal-host>`)

## Site scan
- HTTPS: yes
- HSTS: yes (max-age 63072000)
- CSP: not set — consider adding (follow-up)
- X-Frame-Options: SAMEORIGIN ✓
- .env probe: 404 ✓
- .git probe: 404 ✓

## Dependencies
- bun audit: 0 critical, 2 moderate (both in dev deps; acceptable)
```

## Don't do

- Assume defaults are safe — verify headers actually ship.
- Commit the audit file if it contains sensitive findings — treat like a security advisory.
- Skip the Pagefind index check — it's the sneakiest leak.
