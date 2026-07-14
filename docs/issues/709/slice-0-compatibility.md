# #709 Slice 0 — Pi SDK native-ID compatibility

Issue: #747  
Date: 2026-07-14

## Final gate decision

`supported-native-id`

The resolved Pi SDK consumed by `packages/agent` is `@earendil-works/pi-coding-agent@0.80.3` through the `@mariozechner/pi-coding-agent` alias. This version supports the required native-ID path for later slices:

- `SessionManager.create(cwd, sessionDir, { id })` creates a native session handle with a chosen ID before materialization.
- `SessionManager.getSessionId()` exposes that chosen ID before and after materialization.
- `SessionManager.appendCustomEntry(customType, data)` queues a SDK-supported operation/prompt correlation marker before materialization and persists it when the transcript materializes.
- `SessionManager.appendSessionInfo(name)` / `AgentSession.setSessionName(name)` queue/retain a title before native materialization and persist exactly one native `session_info` when the transcript materializes.
- `SessionManager.open(path, sessionDir, cwdOverride)` recreates a materialized native session with the same ID/title/entries.
- Standalone `pi --session-dir "$nativeSessionDir" --resume` scans the same explicit session directory and cwd and shows the materialized native title/transcript.

No wrapper/native-identity migration behavior is implemented in this slice.

## Current Boring harness observation

The current Pi harness (`packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`) still creates wrapper-backed Boring sessions for product behavior. It already uses the SDK primitives proven here: `SessionManager.create(runtimeCwd, nativeSessionDir)` for new native handles, `SessionManager.open(savedPiFile, undefined, runtimeCwd)` for existing native files, `sessionManager.getSessionFile()` to learn the materialized native path, and `renameLivePendingPiSession(...)` -> `AgentSession.setSessionName(title)` to queue a title while the native file is still absent. This slice only proves compatibility and aligns the package declaration; it does not switch the product identity model.

## Required checklist

- [x] **Exact package decision:** `@mariozechner/pi-coding-agent` resolves to `@earendil-works/pi-coding-agent@0.80.3` for `@hachej/boring-agent`.
- [x] **Dependency reconciliation decision:** `packages/agent/package.json`, root override, and `pnpm-lock.yaml` are aligned to `npm:@earendil-works/pi-coding-agent@0.80.3`.
- [x] **Native ID API decision:** use `SessionManager.create(cwd, sessionDir, { id })`; rejected fallback not needed.
- [x] **Session ID observation decision:** use `SessionManager.getSessionId()` before materialization and after `SessionManager.open(...)`.
- [x] **Prompt intent/correlation marker decision:** use `SessionManager.appendCustomEntry("boring.compat.prompt_intent", data)` before first prompt/materialization; it persists through SDK materialization.
- [x] **Title API decision:** use `SessionManager.appendSessionInfo(name)` directly on `SessionManager`; existing live `AgentSession.setSessionName(name)` delegates to the same native title path.
- [x] **Fallback decision:** no fallback required for this package pin; primary API is supported.
- [x] **Real SDK proof:** `piSdkCompatibility.test.ts` imports and exercises the real resolved SDK.
- [x] **Real CLI proof:** `pi --session-dir "$nativeSessionDir" --resume` was run against the same explicit native session directory/cwd and showed the title.
- [x] **Final gate decision:** `supported-native-id`.

## Version and dependency evidence

Version declarations after this slice:

- Root `package.json` override: `"@mariozechner/pi-coding-agent": "npm:@earendil-works/pi-coding-agent@0.80.3"`.
- `packages/agent/package.json` dependency: `"@mariozechner/pi-coding-agent": "npm:@earendil-works/pi-coding-agent@0.80.3"`.
- `pnpm-lock.yaml` importer entries use specifier `npm:@earendil-works/pi-coding-agent@0.80.3` and version `@earendil-works/pi-coding-agent@0.80.3(...)`.

Command:

```bash
pnpm why @mariozechner/pi-coding-agent --filter @hachej/boring-agent
```

Observed output:

```text
@earendil-works/pi-coding-agent@0.80.3
└── @hachej/boring-agent@0.1.78 (dependencies)

Found 1 version of @earendil-works/pi-coding-agent
```

Command:

```bash
pnpm --filter @hachej/boring-agent exec node --input-type=module - <<'NODE'
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const root = dirname(dirname(new URL(import.meta.resolve('@mariozechner/pi-coding-agent')).pathname));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
console.log(JSON.stringify({ resolvedEntrypoint: import.meta.resolve('@mariozechner/pi-coding-agent'), packageRoot: root, version: pkg.version }, null, 2));
NODE
```

Observed output:

```json
{
  "resolvedEntrypoint": "file:///home/ubuntu/projects/boring-ui-v2-747/node_modules/.pnpm/@earendil-works+pi-coding-agent@0.80.3_@modelcontextprotocol+sdk@1.29.0_zod@3.25.76__ws@8.21.0_zod@3.25.76/node_modules/@earendil-works/pi-coding-agent/dist/index.js",
  "packageRoot": "/home/ubuntu/projects/boring-ui-v2-747/node_modules/.pnpm/@earendil-works+pi-coding-agent@0.80.3_@modelcontextprotocol+sdk@1.29.0_zod@3.25.76__ws@8.21.0_zod@3.25.76/node_modules/@earendil-works/pi-coding-agent",
  "version": "0.80.3"
}
```

## SDK API evidence

Documented installed declarations from `dist/core/session-manager.d.ts` include:

```ts
export interface NewSessionOptions {
  id?: string;
  parentSession?: string;
}

class SessionManager {
  static create(cwd: string, sessionDir?: string, options?: NewSessionOptions): SessionManager;
  static open(path: string, sessionDir?: string, cwdOverride?: string): SessionManager;
  getSessionId(): string;
  getSessionFile(): string | undefined;
  appendCustomEntry(customType: string, data?: unknown): string;
  appendSessionInfo(name: string): string;
  getSessionName(): string | undefined;
}
```

Executable proof command:

```bash
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/harness/pi-coding-agent/__tests__/piSdkCompatibility.test.ts
```

Observed result:

```text
Test Files  1 passed (1)
Tests       3 passed (3)
Type Errors no errors
```

The test proves real SDK behavior:

1. Reads the resolved package version from the installed package root.
2. Builds Boring's native session directory via `PiSessionStore(runtimeCwd, { sessionRoot, storageCwd: runtimeCwd }).getSessionDir()`.
3. Calls `SessionManager.create(runtimeCwd, nativeSessionDir, { id: "compat_747_native_id" })` before any file exists and observes the chosen ID with `getSessionId()`.
4. Recreates a handle with the same chosen ID before materialization.
5. Queues a prompt/correlation marker with `appendCustomEntry(...)` and a title with `appendSessionInfo(...)` before materialization; `getSessionName()` returns the title while the native file is still absent.
6. Appends a user message; native file remains absent.
7. Appends an assistant message; Pi SDK materializes one native JSONL containing the chosen header ID, custom marker, title, user message, and assistant message.
8. Reopens with `SessionManager.open(...)`; ID/title/custom marker are retained.
9. Lists with `SessionManager.list(runtimeCwd, nativeSessionDir)`; one session is returned with the chosen ID/title/path and two messages.

## Standalone Pi CLI proof

Proof command shape for later slices:

```bash
cd "$runtimeCwd"
pi --offline --session-dir "$nativeSessionDir" --resume
```

Observed local proof used a temporary `runtimeCwd`, an explicit `nativeSessionDir`, and one SDK-materialized native session:

```json
{
  "id": "compat_747_doc_cli",
  "title": "Boring #747 CLI proof title",
  "nativeSessionDir": "<temp>/session-root/<cwd-derived-or-explicit-native-dir>",
  "file": "<nativeSessionDir>/2026-07-14T04-27-09-038Z_compat_747_doc_cli.jsonl"
}
```

Sanitized `pi --resume` output included:

```text
Resume Session (Current Fold ◉ Current Folder | ○ All  Name: All  Sort: Threaded
› Boring #747 CLI proof title                                              2 now
```

The executable Vitest proof repeats this with the real `pi` CLI (`dist/cli.js` from the resolved package), waits until the TUI resume scanner prints `Boring #747 native title`, and then terminates the selector. This is intentionally not Boring's filtered list.

## Decision notes for later slices

- Later #709 slices may use native Pi IDs directly for local direct Pi-backed sessions on this package pin.
- No product wrapper removal, native identity migration, private metadata index, or draft/materialize endpoint was implemented in this slice.
- If later slices require stronger prompt-intent semantics than a persisted `custom` entry before first prompt submission, they must validate that exact higher-level contract separately; this slice proves the SDK-supported durable marker primitive exists and survives materialization/reopen/list.
