# Public Workspace Share Routes Plan

## Goal

Let a user share a URL for one workspace Markdown document for external review without exposing the full boring-ui workspace, agent APIs, local bridge, shell, file tree, or editor.

Primary CLI UX:

```bash
boring-ui share docs/review.md --assets

# Optional, explicit: anyone with the URL can edit the Markdown file.
boring-ui share docs/review.md --assets --allow-edit
```

Output:

```text
Share URL: http://127.0.0.1:5200/share/<token>/
Tunnel:    cloudflared tunnel --url http://127.0.0.1:5200
```

## Product stance

This is not "run boring-ui publicly". It is a narrow public capability surface over selected workspace files. The MVP defaults to read-only; public editing is an explicit capability for the entry Markdown file only.

- The reusable route belongs in the workspace/agent server layer because it owns workspace path reads and validation.
- The CLI activates it and provides the one-command local workflow.
- Deployed apps can later reuse the same primitive behind auth, invites, expiry, or project-specific share policies.

## Non-goals for MVP

- No public workspace UI.
- No agent/chat access.
- No file tree or arbitrary file browsing.
- No comments or identity system.
- No edits unless `--allow-edit` is explicitly set for the single Markdown entry file.
- No persistent hosted storage.
- No arbitrary app execution.
- No automatic Cloudflare dependency in the first slice.

## Architecture

### 1. Shared route module

Add a small public-share route module in the server package that already owns workspace file routes.

Candidate location:

```text
packages/agent/src/server/http/routes/publicShare.ts
```

Export:

```ts
registerPublicShareRoutes(app, {
  getShare(token),
  workspace,
})
```

or multi-workspace-ready:

```ts
registerPublicShareRoutes(app, {
  getShare(token, request),
  getWorkspace(share, request),
})
```

Route shape:

```text
GET /share/:token/
GET /share/:token/*
```

The route serves only paths declared by the share record.

### 2. Share record model

MVP in-memory for CLI start is acceptable; keep the model serializable for later persistence.

```ts
type PublicShareRecord = {
  token: string
  kind: 'markdown-review'
  entryPath: string
  capabilities: {
    readFiles: string[]
    renderMarkdown: true
    /** Explicit opt-in: anyone with the URL may overwrite entryPath. */
    writeEntry?: true
  }
  createdAt: string
  expiresAt?: string
  title?: string
}
```

Rules:

- `entryPath` is the Markdown file shown at `/share/:token/`.
- `capabilities.readFiles` includes the entry file and optionally referenced assets.
- Requests cannot supply arbitrary paths outside `capabilities.readFiles`.
- `capabilities.writeEntry` allows editing only `entryPath`, never assets or arbitrary paths.
- Path validation still flows through the workspace adapter.

### 3. Markdown asset dependency collection

For `--assets`, parse Markdown references conservatively:

```md
![alt](relative.png)
![alt](./images/screenshot.png)
<img src="relative.png">
```

Include only local relative asset paths.

Exclude:

- `http://`, `https://`, `data:`, `mailto:`
- absolute `/...` paths unless explicitly mapped later
- paths containing null bytes or traversal after normalization

MVP can be regex-based and covered by tests. No need for a full Markdown parser yet.

### 4. Rendering mode

MVP should serve raw Markdown with a minimal review HTML wrapper at `/share/:token/`, not just `text/markdown`, so external reviewers get a readable page.

Suggested routes:

```text
GET /share/:token/           -> rendered HTML shell for Markdown
GET /share/:token/raw        -> original Markdown
GET /share/:token/assets/*   -> allowed images/assets
POST /share/:token/raw        -> overwrite entry Markdown only when writeEntry is true
```

The renderer can be intentionally minimal:

- escape HTML
- render headings, paragraphs, links, code blocks, lists, and images, or use an existing safe markdown renderer if already present server-side
- rewrite local image URLs to `/share/:token/assets/<encoded-path>`
- set `Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`
- set `X-Content-Type-Options: nosniff`

If rendering is too large for MVP, serve a simple HTML page with a `<pre>` plus working asset links, then improve rendering in PR 2.

### 5. CLI command

Add:

```bash
boring-ui share <file> [options]
```

Options:

```text
--assets              include local Markdown image dependencies
--allow-edit         anyone with the URL can edit the entry Markdown file
--expires <duration>  optional: 1h, 24h, 7d
--port <port>         existing server port option
--host <host>         default 127.0.0.1 for share mode
--no-open             do not open browser
```

Share mode should default host to `127.0.0.1`, even if normal folder mode defaults differently.

CLI behavior:

1. Resolve workspace root as current directory unless `--workspace` or folder arg is added later.
2. Validate target is a file inside the workspace.
3. Build share record.
4. Start a Fastify app with only public share routes and minimal health route, or start normal folder app with public share routes mounted but keep printed guidance clear.
5. Print local URL and tunnel command.

Preferred MVP for safety: start a share-only app for `boring-ui share`, not the full workspace UI.

### 6. Tunneling guidance

Do not run cloudflared automatically in MVP. Print:

```bash
cloudflared tunnel --url http://127.0.0.1:<port>
```

Later option:

```bash
boring-ui share docs/review.md --assets --tunnel
```

This can spawn `cloudflared` only if installed and clearly label the external URL.

## Security requirements

- Public share route must not expose `/api`, file tree, shell, chat, bridge, or plugin code.
- Public editing must be explicit (`--allow-edit`) and limited to the entry Markdown file.
- Token must be unguessable: at least 128 bits of entropy.
- Only explicitly allowed paths are readable.
- No directory listing.
- No symlink/path traversal bypass; all reads go through workspace path validation.
- Do not log file contents.
- Do not include secrets from env/config in the page.
- Markdown HTML must be escaped/sanitized; no arbitrary script.
- Assets get `nosniff` and conservative content types.

## Test plan

### Unit tests

- token generation shape/entropy sanity
- Markdown local asset extraction
- rejects remote/data/mailto URLs from dependency list
- rejects traversal paths
- content type selection
- Markdown link rewriting

### Route tests

- `GET /share/:token/` returns HTML for entry Markdown
- `GET /share/:token/raw` returns Markdown
- allowed image returns bytes with image content type
- read-only share rejects Markdown overwrite
- editable share overwrites only the entry Markdown file
- unlisted workspace file returns 404
- traversal under `/share/:token/assets/../secret` returns 403/404
- unknown token returns 404
- expired token returns 410

### CLI tests

- `boring-ui share --help` documents usage including `--allow-edit`
- missing file fails clearly
- file outside workspace fails clearly
- command prints local URL and cloudflared command

## PR slices

### PR 1 — reusable public share route + tests

- Add share record types and route registration.
- Add Markdown dependency extraction helper.
- Add route tests with an in-memory/mock workspace.
- No CLI command yet except internal test harness if needed.

### PR 2 — CLI `boring-ui share`

- Add CLI command parser branch.
- Start share-only Fastify server.
- Mount public share routes.
- Print local URL + cloudflared guidance.
- Add CLI integration tests.
- Update `packages/cli/README.md`.

### PR 3 — nicer review page

- Improve Markdown rendering/styling.
- Add copy link / raw link.
- Add better error pages.

### PR 4 — optional tunnel integration

- Add `--tunnel`.
- Detect `cloudflared` safely.
- Stream/print the generated `trycloudflare.com` URL.

## Future: sharing mini apps from the workspace

Yes, the same primitive can become the foundation for sharing mini apps, but mini apps should be a separate capability tier from Markdown review.

Potential future command:

```bash
boring-ui share-app apps/demo --build npm:build --dist dist
```

or plugin/workspace-declared:

```bash
boring-ui share apps/demo/index.html --assets --spa
```

Required extra safeguards for mini apps:

- Serve only a static build directory, not source with live workspace access.
- No agent APIs, no workspace bridge, no shell.
- Strict CSP by default.
- Optional allowlist for external network origins.
- Explicit warning if the static app contains JS.
- Separate share kind:

```ts
type PublicShareRecord =
  | { kind: 'file'; entryPath: string; allowedPaths: string[]; ... }
  | { kind: 'static-app'; entryPath: string; allowedPaths: string[]; spaFallback?: boolean; ... }
```

Recommended sequence:

1. Ship Markdown file + image dependency sharing.
2. Add folder/static asset sharing.
3. Add static mini-app sharing from build output.
4. Only much later consider interactive workspace-backed mini apps with explicit auth/capabilities.

## Open questions

1. Should MVP render Markdown to HTML or serve raw Markdown plus assets?
2. Should share records persist to `.boring/shares.json`, or stay in-memory for the first CLI session?
3. Should `boring-ui share` default to a share-only server on port 5201 to avoid confusion with the full workspace UI?
4. Should expiry default to session-only, 24h, or no expiry for local CLI shares?
