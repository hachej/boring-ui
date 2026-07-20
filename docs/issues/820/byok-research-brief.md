# BYOK Secret Vault — Best-Practices Brief (Node 22 / TS / Postgres / Vault / sandboxes)

Scope: tenants paste their own third-party API keys; stored server-side; injected per-execution, including into sandboxes running untrusted tenant code. Two deploy modes (SaaS + self-host). This brief is the MANDATORY grounding for the BYOK secret-vault plan — cite its sources; where the plan's instinct differs from this brief, follow the brief and note it.

## Recommended architecture (opinionated)

**Vault Transit envelope encryption + per-workspace DEK + AAD-bound AES-256-GCM, with a pluggable KEK provider for self-host.** Strongest option given Vault is already deployed; keeps the KEK out of the app entirely.

- The Node service never holds the KEK. On write, call Transit `POST /transit/datakey/plaintext/:name` to get a fresh DEK as `{plaintext, ciphertext}` (https://developer.hashicorp.com/vault/api-docs/secret/transit, https://developer.hashicorp.com/vault/docs/secrets/transit/envelope-encryption). Encrypt the secret locally with the plaintext DEK, immediately drop the plaintext DEK, persist `{ciphertext, wrapped_dek (EDK), nonce, aad_context, key_version}` in Postgres. On read, send the EDK to `POST /transit/decrypt/:name`, get the DEK back, decrypt, use, drop. KEK stays inside Transit, never exposed.
- **Why not a single app-wide symmetric key:** makes the whole store recoverable from one compromised key, defeats per-tenant crypto-shredding, violates OWASP "keys stored separately from encrypted data" (https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html).
- **Per-tenant/per-workspace DEK, not per-secret:** one crypto-shred lever per tenant without per-row re-encryption (https://en.wikipedia.org/wiki/Crypto-shredding). Per-secret DEKs add isolation but multiply rotation cost; per-workspace is right for BYOK.

## Node crypto specifics (the AES-GCM fallback / local layer)

- `node:crypto` `createCipheriv('aes-256-gcm', dek, iv)`; **12-byte random nonce** per encryption, never reused under one key. Store `getAuthTag()` (16 bytes) and VERIFY via `setAuthTag()` on decrypt — GCM without tag verification is not authenticated.
- **AAD anti-swap binding:** `cipher.setAAD(Buffer.from(workspaceId + ':' + secretId))` before `update()`. A row copied into another tenant's record fails authentication.
- **Forbid:** ECB, static/zero IV, reused nonce, `createCipher` (deprecated), `Math.random()` for keys/nonces (use `crypto.randomBytes`). OWASP: authenticated modes first; ECB not to be used; never hard-code keys or put them in env vars. libsodium (`sodium-native` `crypto_aead_xchacha20poly1305`, 24-byte nonce) is an equally valid misuse-resistant AEAD; pick one.

## Vault auth, policy, self-host fallback

- **AppRole** for the Node service: RoleID + SecretID → short-lived token; renew at ~50% TTL, `token_num_uses=0` (https://developer.hashicorp.com/vault/docs/auth/approle). Least-privilege policy: only `transit/encrypt/*`, `transit/decrypt/*`, `transit/datakey/*` on the tenant key namespace — NOT `transit/keys/*` delete/rotate (rotation behind a separate admin path).
- **Pluggable KEK provider** so self-host without Vault still works: same envelope interface, KEK from a sealed local file / env (age/sealed-box) or cloud KMS. Transit is the default; degrade explicitly, never silently to a plaintext key.

## Lifecycle

- **KEK rotation:** `POST /transit/keys/:name/rotate` (new encryptions only); `POST /transit/rewrap/:name` re-encrypts existing EDKs to latest version without exposing plaintext — background rewrap job. `min_decryption_version` retires old versions. Rotation code in place BEFORE needed.
- **Revocation / crypto-shred:** delete the Transit key version (or workspace DEK) → tenant ciphertext unrecoverable; fast provable delete for GDPR/offboarding.
- **Audit:** log who/which-secret/which-workspace/when — never the value. Enable Vault audit devices (HMAC secret values).

## Process-memory reality (be honest)

You CANNOT reliably zeroize secrets in Node/V8. Buffers are off-heap and overwritable (`buf.fill(0)`) — do it for DEKs/plaintext — but once a secret is a JS **string** it is immutable, GC-copied, un-wipeable, and may persist in heap snapshots/core dumps/APM. Mitigations: keep secrets in `Buffer`, never interpolate into strings/URLs/query params, JIT-decrypt right before the outbound call and drop immediately, scrub logging/error/APM. Zeroization = best-effort, not a guarantee.

## Exposure surface / API design

- **Write-only secrets:** never return the value; masked last-4 only.
- **Postgres/Drizzle:** disable query logging for secret tables, never log the row, keep ciphertext out of Drizzle debug/`logger:true`, never a secret in a `WHERE` literal.
- **Comparisons:** `crypto.timingSafeEqual(a,b)` (equal-length Buffers; length-guard first).

## Sandbox injection

- **Never env vars / argv / image layers** for tenant secrets: leak via `/proc/<pid>/environ`, `docker inspect`, `ps`, crash dumps (https://www.nodejs-security.com/blog/do-not-use-secrets-in-environment-variables-and-here-is-how-to-do-it-better). OWASP discourages env-var secrets.
- **Prefer:** stdin/pipe or a `tmpfs`-mounted file scoped to the single execution, short-lived, unmounted/zeroed after.
- **Hard truth:** a tenant's own untrusted code can always read a key legitimately handed to it. Injection secures against OTHER tenants and the host — **per-workspace isolation is the real boundary.** Inject only the requesting tenant's own keys, one execution at a time. For **first-party trusted tools** (Tavily/transcription proxies), DO NOT inject — resolve host-side, make the outbound call from a trusted proxy, return only results to the sandbox.

## OAuth vs stored keys

Prefer OAuth + short-lived tokens with refresh where supported (Stripe Connect, Google): compromise window shrinks to minutes. Store the refresh token as the long-lived secret (same envelope pipeline), refresh server-side (BFF), rotate on use (https://duendesoftware.com/learn/best-practices-managing-token-expiration-refresh-revocation-in-web-apis). Stored API keys only when nothing better exists.

## Anti-patterns to forbid

Single app-wide key · AES-GCM without tag verification (or CBC without MAC) · reused/static nonce · secrets in env/argv/image layers into sandboxes · injecting keys the requesting tenant doesn't own · returning stored secrets over the API · secrets in logs/URLs/Drizzle debug/APM · `==`/`===` for secret comparison · app holding the KEK · rotation code written only after a breach.

## Primary sources

OWASP Cryptographic Storage / Secrets Management / Key Management cheat sheets · Vault Transit envelope-encryption + API docs · Vault AppRole · nodejs-security env-var leakage · Crypto-shredding · OAuth refresh best practices (Duende). Verify Transit datakey/rewrap/min_decryption_version against the DEPLOYED Vault version; Node crypto GCM/timingSafeEqual/setAAD confirmed for Node 22/24.
