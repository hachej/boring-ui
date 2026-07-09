# Vision

Office users should be able to open Excel, ask the in-app agent to read or write workbook context, and save a durable SharePoint cloud reference that boring-ui can render. The same connector path should later work from PowerPoint without rewriting the connector.

## Product Shape

Lane A ships value first:

- Excel taskpane extension runs inside `pi-for-excel`.
- The extension calls boring-ui `/api/v1` routes with a workspace-scoped bearer token.
- The extension writes `.xlsx.cloud.json` refs that the merged boring-sharepoint panel already understands.
- Live proof uses a real M365 workbook, a real hub, and a sideloaded add-in.

Lane B creates the controlled fork:

- `tmustier/pi-for-excel` becomes `hachej/pi-for-office`.
- Excel remains the first host.
- A `DocumentHost` seam isolates the Excel-coupled joints.
- PowerPoint ships through the same extension API and connector.

Future W-word work is intentionally only a future lane. Do not create a Word work package in this pack. Start it only after B2 ships and usage validates the host seam.

## What Exists Today

- `pi-for-excel` is viable as an in-Excel agent surface, not as a boring-ui MCP server. The spike found no MCP endpoint to call directly (`/home/ubuntu/projects/ext-pi-for-excel-test/INTEGRATION-SPIKE.md:3-30`).
- The connector spike already registers boring-ui tools, builds SharePoint cloud refs, redacts forbidden values, and passes a headless runtime test (`/home/ubuntu/projects/ext-pi-for-excel-test/INTEGRATION-SPIKE.md:95-190`).
- The spike could not authenticate to boring-ui from the Office surface because boring-ui only accepts the Better Auth browser session today (`packages/core/src/server/auth/authHook.ts:26-60`).
- CORS is configured through `CORS_ORIGINS`; Better Auth trusted origins consume the same list (`packages/core/src/server/config/loadConfig.ts:143-200`, `packages/core/src/server/auth/createAuth.ts:143-149`).
- The boring-sharepoint plugin already validates `.xlsx.cloud.json` and `.pptx.cloud.json`, forbids secrets, and renders refs without preview routes (`plugins/boring-sharepoint/README.md:28-78`, `plugins/boring-sharepoint/src/shared/ref.ts:14-147`).
- Current `pi-for-excel` extension APIs are host/runtime APIs. They do not expose open workbook identity to extensions (`/home/ubuntu/projects/ext-pi-for-excel-test/INTEGRATION-SPIKE.md:142-149`, `/home/ubuntu/projects/ext-pi-for-excel-test/boring-connector/boring-connector.mjs:161-199`).
- The Arcade headless Excel spike is context only and out of scope for this pack (`/home/ubuntu/projects/wt-excel-spike/SPIKE-REPORT.md:457-485`).

## Binding Design

The production path is:

1. Office taskpane loads `pi-for-excel` or the later `pi-for-office` host.
2. The host loads `boring-connector.mjs` from a private HTTPS URL or install code.
3. The host injects the boring-ui base URL, workspace ID, and API token through the pi extension connection bundle.
4. The connector calls boring-ui `/api/v1` with `Authorization: Bearer <token>` and `x-boring-workspace-id`.
5. boring-ui authenticates the token for exactly one workspace.
6. The connector writes a cloud ref only after the workbook URL resolves to `{siteId, driveId, driveItemId}`.

The connector remains a single reviewable `.mjs` file. It must not store tokens in refs, tool output, logs, or bundle defaults.

## Server Boundary

A1 adds the minimum boring-ui server support needed by any external surface:

- Workspace API tokens are stored hashed.
- A token scopes to one workspace.
- Token CRUD is a logged-in owner surface.
- Token auth does not open workspace admin/member/invite routes.
- CORS admits the Office taskpane origin through existing `CORS_ORIGINS` plumbing.

A3 adds one boring-ui Office route: resolve a SharePoint document URL to stable IDs through Microsoft Graph. This route is direct Graph integration, not Arcade SDK, because the boring-sharepoint substrate is route-free and the cross-pack gate forbids Arcade SDK in boring-ui.

## Fork Boundary

B1 and B2 land in `hachej/pi-for-office`, not boring-ui.

The host seam covers these Excel-coupled joints from current pi-for-excel source:

- `Excel.run` wrapper: `src/excel/helpers.ts:23-29`.
- Workbook/document context and URL hash: `src/workbook/context.ts:10-43`, `src/workbook/context.ts:141-158`.
- Selection reader: `src/context/selection.ts:31-98`.
- Change tracker: `src/context/change-tracker.ts:21-98`.
- Mutation coordinator and recovery: `src/workbook/coordinator.ts:56-219`, `src/workbook/recovery-log.ts:55-220`, `src/tools/mutation/finalize.ts:13-50`.

Excel should wrap existing behavior first. PowerPoint should use the same extension API surface after the seam exists.

## Same-Definition Boundary

**Amendment (2026-07-08):** this Office pack does not by itself satisfy the
#391 same-definition requirement. `pi-for-excel` / `pi-for-office` runs its own
loop and reaches boring-ui through `/api/v1`, model gateway, and connector
contracts. If Office must become part of the #391 Shape C story, add a future
size-L work package that either maps the canonical
`AgentDefinitionDeclaration` into the Office wrapper without loss or routes
Office requests through deployed boring agents instead of the separate
pi-for-excel loop.

## Self-Hosting Decision

Company use must not send workbook data through the author's Vercel deployment. The production taskpane bundle and connector must be self-hosted on a controlled HTTPS origin, and that origin must be the one added to `CORS_ORIGINS` and pi remote-extension allowlists.

## Non-Goals

- No Arcade SDK in boring-ui.
- No server-side Office document editing in boring-ui.
- No attempt to clone Excel's UI in boring-ui.
- No PowerPoint chart authoring, calc semantics, animations, or speaker notes in B2.
- No Word package in this pack.
