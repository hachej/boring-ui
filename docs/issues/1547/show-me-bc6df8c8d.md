# [Invite Idempotency] What changed, visually

Code revision: `bc6df8c8db035e8a8fbc38de30bfe3fe384de829`  
Current-main integration base: `d19b04d357ea7d2caae20a44a657edb3ee4c582e`

## The request is claimed before the effect

```diff
 POST /api/v1/workspaces/:workspaceId/invites
- authorize owner
- create invite + send email
- write response under a globally scoped key
+ authorize owner and validate the canonical body
+ derive scope = [app, operation, workspace, authenticated actor]
+ hash the validated payload
+ atomically claim [scope, Idempotency-Key] before creating the invite
+ create invite + attempt email exactly once for the admitted claim
+ bind the completed response to the claim for authorized replay
```

## Claim outcomes are explicit

```diff
 IdempotencyKeyStore
+ claim(key, scope, requestHash)
+   claimed   -> this request may perform the effect
+   replay    -> return the matching completed response
+   pending   -> 409 idempotency_in_progress; do not repeat
+   conflict  -> 409 idempotency_key_conflict; do not disclose/replay

 sweep()
- delete every receipt older than 24 hours
+ delete completed receipts older than 24 hours
+ retain unresolved claims until an operator reconciles the outcome
```

## Storage supports an unresolved claim

```diff
 idempotency_keys
   key              text primary key
   scope            text not null
-  response_status  integer not null
-  response_body    jsonb not null
+  request_hash     text nullable       # null preserves legacy rows
+  response_status  integer nullable    # null means outcome unresolved
+  response_body    jsonb nullable
   created_at       timestamp not null
```

## End-to-end sequence

```mermaid
sequenceDiagram
    participant C as Authenticated caller
    participant R as Invite route
    participant I as Idempotency store
    participant W as Invite/mail effect
    C->>R: POST invite + Idempotency-Key
    R->>R: authorize owner + validate body
    R->>I: claim(app, operation, workspace, actor, key, payload hash)
    alt first matching request
        I-->>R: claimed
        R->>W: create invite; attempt email
        R->>I: store 201 response on claim
        R-->>C: 201
    else matching completed request
        I-->>R: replay(receipt)
        R-->>C: same stored response
    else unresolved or mismatched request
        I-->>R: pending or conflict
        R-->>C: 409; no effect and no foreign receipt
    end
```

## Operational boundary

```diff
 deployment
+ apply migration 0028 before new code
+ drain old in-flight invite requests before mixed-version cutover
+ do not sweep unresolved claims
+ reconcile an unresolved claim by inspecting invite/mail outcome
- do not retry with a fresh key without knowing whether the effect happened
```
