# C3 — Branding/Persona Seam + Packaging/Release Plan

## Today / Delta

Today, branding strings are hardcoded across the taskpane HTML (`src/taskpane.html:6-9`), public landing page (`public/index.html:6-13`), welcome login (`src/taskpane/welcome-login.ts:84-99`), status bar mark/tooltips (`src/taskpane/status-bar.ts:142-149`), and manifest (`manifest.prod.xml:11-17`, `manifest.prod.xml:65-80`). Theme tokens live in `src/ui/theme/tokens.css:8-148`; the disclosure bar hardcodes external-capability copy (`src/ui/disclosure-bar.ts:41-64`); the system-prompt identity/persona is hardcoded (`src/prompt/system-prompt.ts:369-395`, composed at `src/prompt/system-prompt.ts:298-340`). The demo served `dist/` from an author-controlled origin with CSP opened to demo tailnet/localhost hosts and a hand-made manifest (`HOSTED-BUILD-REPORT.md:28-34`, `HOSTED-BUILD-REPORT.md:69-89`).

Delta (issue #551 phases 6–8): a wrapper branding/config seam so Boring product changes are data/config changes, not a broad fork; `manifest.boring.xml` generated from config; production CSP allowlists with demo tailnet/localhost removed; a build smoke proving no demo secret/host residue; and a release proof runbook.

## Deliverables

- `src/wrapper/branding.ts`: `appName`, `shortName`, `statusMark`, `supportUrl`, manifest display strings, theme token overrides, disclosure feature rows/visibility, `systemPromptIdentity` + optional static wrapper instructions.
- Branding applied to: taskpane title/theme meta, welcome overlay logo/title/subtitle/intro, status mark/tooltips that say "Pi", loading/error product labels.
- Theme via CSS variables in a dedicated imported partial (keep the Tailwind v4 layering rule from `src/ui/README.md:25-76`); verified with the UI gallery.
- Disclosure bar rows/copy replaced (or bar disabled) to match Boring's actual capabilities; system prompt `IDENTITY` configurable through `buildSystemPrompt()` options with a stable prompt prefix (no timestamps, random ids, token data, volatile workspace metadata).
- `manifest.boring.xml` generated from config: unique add-in id, Boring DisplayName/Description, icon URLs, taskpane URL, support URL, AppDomains.
- Production CSP allowlists containing only required Boring add-in and hub/gateway origins; demo tailnet and localhost entries removed.
- Build smoke: built JS/CSS/assets contain no demo token, workspace id, or tailnet host.
- Release proof: sideload, Boring login, workspace-scoped token, run the four `boring_*` tools, model switching only within policy, logout blocks the agent.

## Exit Criteria

- The wrapper build carries Boring name, icons, colors, support URL, manifest DisplayName, taskpane title, welcome copy, and status mark.
- Disclosure bar matches Boring's allowed capabilities or is disabled.
- System prompt identifies the agent as Boring's Excel agent and preserves Excel safety/workflow instructions.
- Manifest validates as XML and sideloads in Excel with Boring branding.
- `dist/src/taskpane.html` and server headers contain the production CSP; built assets contain no demo token, workspace id, or tailnet host.
- `npm run build`, `npm run check`, `npm run test:models`, `npm run test:security`, and the Boring connector tests pass; UI gallery screenshots cover taskpane, login gate, disclosure/status bar, and settings surfaces.
- The release proof runbook has been executed once end-to-end and recorded.
