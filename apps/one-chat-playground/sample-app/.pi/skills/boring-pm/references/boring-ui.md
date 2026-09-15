# Boring UI implementation handoff

Reference repository: [hachej/boring-ui](https://github.com/hachej/boring-ui). Inspected revision: `75b3d051157a32c3f960fa452da54704451fb049`, reviewed 2026-09-11. Treat this as a source snapshot; inspect the target version before implementation.

## Verified framework baseline

| Capability | Source | Implication for a product spec |
| --- | --- | --- |
| Chat plus workbench; Pi agent runtime; React/Vite frontend and Node backend | [S19](sources.md#s19) | Describe both the intent expressed in chat and the result the user inspects |
| Pi resources in `package.json#pi`; UI/server integration in `package.json#boring` | [S19](sources.md#s19), [S22](sources.md#s22) | Separate agent knowledge from optional product panels and server behavior |
| Workspace interfaces shared by agent tools and frontend file operations | [S19](sources.md#s19) | Keep one authoritative project artifact visible to the agent and user |
| `UiBridge` commands including `openFile`, `openPanel`, `openSurface` | [S19](sources.md#s19) | Plan how the agent presents an artifact without inventing DOM-control APIs |
| `ask_user` with typed forms, durable questions, and blocking/nonblocking modes | [S20](sources.md#s20) | Reuse installed interview surfaces where helpful; verify host composition |
| Package plugins created with `boring-ui-plugin create`; local runtime plugins with `scaffold` | [S21](sources.md#s21) | Choose the deployment model before producing code or installation instructions |

The inspected Ask User plugin supports text, textarea, select, multiselect, checkbox, radio, and number fields. It does not document file-upload fields. Narrative interviews may use ordinary chat or a simple textarea; do not force every answer into multiple choice. The documented provider is composed statically in the app shell. Agent resources can reload in supported hosts; server integration is boot-time. Read the upstream source for actual installation and runtime behavior.

## Translate product behavior into a build packet

For each selected requirement, identify:

1. What the user asks or does.
2. The result they inspect or correct in the workbench.
3. The existing prompt, skill, tool, file view, or plugin to reuse.
4. Any new panel, tool, data model, or backend operation explicitly marked **proposed**.
5. Authoritative storage, user/workspace context, error behavior, and recovery.
6. The acceptance check that proves the complete task through those boundaries.

For a first product, existing file views may suffice. Add a custom panel when it enables a named user action such as comparing alternatives or correcting a rule. Do not build a dashboard simply to visualize internal process.

## Example mapping — proposed release review tool

| Requirement | User interaction | Workbench artifact | Implementation work |
| --- | --- | --- | --- |
| Inspect change candidates | Ask for a comparison of two supplied summaries | Table with source links and unresolved items | Proposed comparison/parser logic; reuse file display or add a panel if needed |
| Correct a review decision | Mark an item reviewed and add a note | Updated item plus history | Proposed domain operation and persistence |
| Recover an interrupted review | Reopen the workspace | Same review decisions and remaining items | Verify selected persistence and recovery path |

These behaviors are not existing Boring UI product features. The framework supplies reusable primitives; the consuming product implements the domain logic.

## Handoff boundary

Use [the Boring UI template](../assets/templates/07-boring-ui-spec.md). Record exact versions, inspected files, commands from the target repository, and unresolved integration questions. Do not transplant a monorepo template's `workspace:*` dependencies into an unrelated standalone project and call it runnable.

Boring UI's reference applications are starting points; the consuming application owns its production configuration and operations. No running Boring PM integration or deployment is included in this skill. The skill remains usable in an ordinary agent session without Boring UI tools; return the implementation handoff as an artifact when those tools are absent.
