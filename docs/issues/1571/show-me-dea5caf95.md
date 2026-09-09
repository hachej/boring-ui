# [Nodemailer Bump] Show me · `dea5caf95`

## Package flow

```text
packages/core
  auth + invite callers
    MailTransport.send(RenderedEmail)
      SmtpTransport
        nodemailer package export
          SMTP server
```

## Effective PR change

```diff
 packages/core/package.json
-  "nodemailer": "^9.0.4"
+  "nodemailer": "^9.1.1"

 pnpm-lock.yaml
-  nodemailer@9.0.4
+  nodemailer@9.1.1

 packages/core/src/server/mail/transport.ts
   # unchanged: createTransport(url) → sendMail(message)

 packages/agent/src/server/agent-host/requestLedger.ts
   # unchanged: prior SQLite lock did not reproduce in 20 serial runs
```

## Delivery outcome

```diff
 PR #1571
+  current origin/main merged without history rewrite
-  initial Unit Tests Changed: SQLite database locked
+  requestLedger targeted reproduction: PASS 20/20
+  current-head GitHub Unit Tests Changed: PASS
+  core mail tests: PASS 21/21
+  workspace typecheck + invariants + import audit: PASS
```
