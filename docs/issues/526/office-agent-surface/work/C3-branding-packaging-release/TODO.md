# C3 — Branding/Persona Seam + Packaging/Release TODO

### C3-001 — Wrapper Branding Config Seam — M

- **Goal:** One `src/wrapper/branding.ts` config module owns every Boring-visible product string/token.
- **Files to touch/create:**
  - `src/wrapper/branding.ts`
  - `src/wrapper/__tests__/branding.test.ts`
- **Steps:**
  1. Define `appName`, `shortName`, `statusMark`, `supportUrl`.
  2. Define manifest display strings, theme token overrides, disclosure feature rows/visibility.
  3. Define `systemPromptIdentity` and optional static wrapper instructions.
- **VERIFICATION:**
  - `npm test -- branding` — config shape + defaults tests pass.
  - `npm run check` — exits 0.
- **Acceptance criteria:**
  - Boring product changes are data/config changes in this module, not scattered source edits.
- **Estimated size:** M.

### C3-002 — Apply Branding to Taskpane/Welcome/Status/Loading — M

- **Goal:** Every "Pi" product string in the UI surface reads from the branding seam.
- **Files to touch/create:**
  - `src/taskpane.html:6-9` (title/theme meta)
  - `src/taskpane/welcome-login.ts:84-99` (logo/title/subtitle/intro)
  - `src/taskpane/status-bar.ts:130-149` (status mark/tooltips)
  - `src/ui/loading.ts:12-29` (loading/error labels, if needed)
  - `src/wrapper/__tests__/branding-apply.test.ts`
- **Steps:**
  1. Replace hardcoded strings with branding config reads at each listed seam.
  2. Keep edits to shared files as import/wiring seams only.
- **VERIFICATION:**
  - `npm test -- branding-apply` — rendered surfaces show branding values, no residual "Pi" mark where branded.
- **Acceptance criteria:**
  - Taskpane title, welcome copy, and status mark come from `src/wrapper/branding.ts`.
- **Estimated size:** M.

### C3-003 — Theme Tokens Partial + UI Gallery Proof — S

- **Goal:** Boring theme lands as CSS-variable overrides in one imported partial.
- **Files to touch/create:**
  - `src/wrapper/theme.css` (new partial imported via `src/ui/theme.css:14-25`)
  - UI gallery entries per `src/ui/README.md:93-99`
- **Steps:**
  1. Override tokens from `src/ui/theme/tokens.css:8-148` in the wrapper partial; do not edit component files.
  2. Keep the Tailwind v4 layering rule (`src/ui/README.md:25-76`).
  3. Capture UI gallery screenshots: taskpane, login gate, disclosure/status bar, settings.
- **VERIFICATION:**
  - `npm run check` — exits 0; gallery screenshots recorded in the PR.
- **Acceptance criteria:**
  - Theme changes are one-partial edits; gallery covers the four required surfaces.
- **Estimated size:** S.

### C3-004 — Disclosure Bar + System-Prompt IDENTITY Seam — M

- **Goal:** Disclosure copy matches Boring's real capabilities; the agent identifies as Boring's Excel agent.
- **Files to touch/create:**
  - `src/ui/disclosure-bar.ts:41-64` (rows/copy or disable switch)
  - `src/prompt/system-prompt.ts:298-340`, `src/prompt/system-prompt.ts:369-395` (`IDENTITY` via `buildSystemPrompt()` options)
  - `src/taskpane/init.ts:535-544` (call site wiring)
  - `src/wrapper/__tests__/persona.test.ts`
- **Steps:**
  1. Drive disclosure rows/visibility from branding config; hide/rename external MCP/skills rows if not part of Boring's surface, keeping copy consistent with actual tool availability.
  2. Make `IDENTITY` configurable (or append a static wrapper section) through `buildSystemPrompt()` options.
  3. Keep the prompt prefix stable: no timestamps, random ids, user token data, or volatile workspace metadata.
- **VERIFICATION:**
  - `npm test -- persona` — prompt snapshot shows Boring identity, preserves Excel safety/workflow sections, and is byte-stable across runs.
- **Acceptance criteria:**
  - Disclosure bar matches allowed capabilities or is disabled; persona is config-driven.
- **Estimated size:** M.

### C3-005 — `manifest.boring.xml` Generation from Config — M

- **Goal:** The production manifest is generated, not hand-edited.
- **Files to touch/create:**
  - `scripts/generate-manifest.mjs` (or equivalent build step)
  - `manifest.boring.xml` (generated output)
  - `src/wrapper/__tests__/manifest.test.ts`
- **Steps:**
  1. Generate unique add-in id, Boring DisplayName/Description, icon URLs, taskpane URL, support URL, and AppDomains from branding + deploy config.
  2. Validate the output as XML.
- **VERIFICATION:**
  - `npm test -- manifest` — generated manifest validates and contains the configured values, no demo hosts.
- **Acceptance criteria:**
  - Manifest validates as XML and sideloads in Excel with Boring branding.
- **Estimated size:** M.

### C3-006 — Production CSP + Build Smoke — M

- **Goal:** Production CSP admits only required origins; built assets carry no demo residue.
- **Files to touch/create:**
  - `src/taskpane.html:6-9`, `public/index.html:6-8`, `vercel.json:71-81` (or the self-host header config that replaces it)
  - `scripts/build-smoke.mjs` (grep gate over `dist/`)
- **Steps:**
  1. Restrict CSP `connect-src` allowlists to the required Boring add-in and hub/gateway origins; remove demo tailnet and localhost entries from production.
  2. Keep OAuth/callback rewrites only if the login flow needs them.
  3. Add a build smoke that fails if `dist/` contains a demo token, demo workspace id, or tailnet host.
- **VERIFICATION:**
  - `npm run build && node scripts/build-smoke.mjs` — exits 0; a planted demo host makes it fail.
  - `npm run test:security` — exits 0.
- **Acceptance criteria:**
  - `dist/src/taskpane.html` and server headers contain the production CSP.
  - Built JS/CSS/assets contain no demo token, workspace id, or tailnet host.
- **Estimated size:** M.

### C3-007 — Release Proof Runbook — S

- **Goal:** One executed, recorded end-to-end proof of the shippable wrapper.
- **Files to touch/create:**
  - `docs/release-proof.md` (wrapper repo)
- **Steps:**
  1. Sideload the generated manifest in Excel.
  2. Log in with a Boring account; receive a workspace-scoped token (A1 shape).
  3. Run the four `boring_*` tools against a real hub.
  4. Verify model switching is only possible within policy (C2).
  5. Log out; verify the agent is blocked.
  6. Record proof (screenshots + command transcript) with no token values.
- **VERIFICATION:**
  - `npm run build`, `npm run check`, `npm run test:models`, `npm run test:security`, and the Boring connector tests all exit 0 on the release commit.
- **Acceptance criteria:**
  - The runbook is reproducible by a fresh agent; the recorded proof contains no secrets.
- **Estimated size:** S.
