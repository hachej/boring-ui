# Audience screen

A platform block (`platform.json`): the app mounts it as a screen. Its source is boring-factory's `templates/app`, refreshed in the live template app by the `template-sync` workflow (`scripts/ship-template.mjs`). New apps fork that live commit; existing apps adopt updates explicitly.
It shows, for the app's owner: the landing page's visits per day, the visits per outreach link (`?ref=<id>`), the access requests, and
usage counts (the sample against the person's own file). **Totals only**: no address, no browser, no file content.

## Mount it (three lines of the app's own)

1. Server, `server/src/app.ts`, in the `/api` group (the screen is the owner's: `readAudience` answers 403 to anyone else):

   ```ts
   import { readAudience } from "./audience.ts"
   api.get("/audience", async (c) => c.json(await readAudience(c.env, { usage: () => invoke(readUsage, {}, c.env) as Promise<UsageCount[]> })))
   ```

   Without `usage` the screen says the app does not count its usage yet. `env.landing` is the host's (`host.ts`); on the local runtime it is
   absent and the screen says the totals are not available yet.

2. Web: fetch `/api/audience`, pass it through `readAudience` of `audience-model.ts`, and render
   `<Audience data={data} locale="fr" />` as a screen (a mockup must exist first for a new screen).

3. Outreach links: give each recipient the landing address with their own id, `https://<app>.senecaapp.ai/?ref=acme-1`
   (letters, digits, `-`, `_`, at most 32). The host counts the visit under that id.

## Usage counts (the app's own counter)

The platform does not know what "using the sample" means in an app, so the app counts it. One small table, one write per event, no data:

```sql
-- migrations/NNNN_audience_usage.sql
CREATE TABLE audience_usage (kind TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);
```

- Count in the operation that does the thing, in the same commit: `INSERT INTO audience_usage (kind, n) VALUES ('sample', 1) ON CONFLICT(kind) DO UPDATE SET n = n + 1`
  (kinds the screen reads: `sample`, `own_file`; the app may count others and show them itself).
- Read it in an operation (`SELECT kind, n FROM audience_usage ORDER BY kind`) and pass it as `usage` above. A route never reads the table itself.
- Never store the file, its name, a cell or who it was: a count and nothing else.

## Access requests

Today they are listed, granted and dismissed in the hub (the directory answers only to the owner's hub sign-in). Pass `requests` to `<Audience>`
only when the app has a route that does it; without it the screen points to the hub.

## Outreach and Inbox (the platform sends, the owner confirms)

Two more panels of the same tab, `<OutreachPanel>` and `<InboxPanel>` (presentation only), over `env.outreach` (boring-factory `docs/services/OUTREACH.md`).
The app writes from `<app>@mail.senecaapp.ai` (display name: the app's title); replies come back to the same address, into the Inbox. The host sends
ONLY after the owner's confirm, one send per click (first sends and replies alike), at most 20 a day, and only once the owner has entered who is
writing (name, company, postal address: printed in every footer, with an unsubscribe link). An unsubscribed address is never written to again.

1. Server, in the `/api` group (all owner only; the host's refusals keep their `extra.code`):

   ```ts
   import { prepareOutreach, readOutreachState, readOutreachThread, saveOutreachProfile, sendOutreach } from "./outreach.ts"
   api.get("/outreach", async (c) => c.json(await readOutreachState(c.env)))
   api.post("/outreach/profile", async (c) => c.json(await saveOutreachProfile(c.env, await c.req.json())))
   api.post("/outreach/prepare", async (c) => c.json(await prepareOutreach(c.env, await c.req.json())))
   api.post("/outreach/send", async (c) => c.json(await sendOutreach(c.env, await c.req.json())))
   api.get("/outreach/threads/:id", async (c) => c.json(await readOutreachThread(c.env, c.req.param("id"))))
   ```

2. Drafts and recipients are files the owner (or the PM) writes: `documents/outreach/<id>.md` (a `Subject: ...` first line, then the text; `{{link}}`
   becomes the landing address with the recipient's `?ref=`) and `documents/outreach/recipients.txt` (one `address[, ref]` a line). Read them with
   `parseDraft` and `parseRecipients` of `outreach-model.ts`.

3. Web: pass `/api/outreach` through `readOutreach`, render `<OutreachPanel data drafts recipients now onSaveProfile onPrepare onSend labels>` and
   `<InboxPanel threads unread onOpen onChanged onPrepare onSend labels>` under the Audience cards (labels: `outreachLabelsFor("fr")`). `onPrepare` posts to
   `/api/outreach/prepare`; a rejected call must carry the answer's `extra.code` as `error.code` so the dialog can say what to fix. Reload `/api/outreach` after a send.
   The inbox shows the sender's text as text only; the sender's address is not verified.
