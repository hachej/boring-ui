# Boring App Setup — Bridge vs Route Decision Matrix

Use this file when deciding how child-app behavior should move between browser, agent/runtime, and server.

## 1. UI control actions

Use the workspace UI bridge when the action is about controlling workspace UI:

- open panel
- open file
- focus a surface
- navigate to line
- show UI notification

These are UI effects, not domain APIs.

## 2. Workspace surface resolution

Use plugin/front surface resolvers when the problem is:

- map a typed request to a concrete panel
- decide which panel should open for a domain target

## 3. Product/domain data operations

Use an app-owned backend API or trusted server/plugin contract when the operation is domain data logic:

- fetch/search domain records
- run domain service logic
- persist domain mutations
- query backend data stores

Do not misuse the UI bridge as a data transport.

## 4. File-like workspace assets

Prefer existing workspace file/raw-file mechanisms when the thing is really a file or generated asset:

- workspace documents
- generated artifacts
- cache files exposed in workspace

Do not invent a custom route if the workspace file path is the real source of truth.

## 5. Agent/runtime calls

If the runtime/SDK/agent needs a real backend capability:

- use trusted server/plugin/tool/backend paths intentionally
- keep the contract explicit
- avoid hardcoded localhost assumptions

## Quick matrix

| Need | Preferred path |
|---|---|
| open/focus/show UI | UI bridge |
| map domain target to panel | surface resolver |
| fetch domain data | backend route/service/plugin contract |
| mutate domain data | backend route/service/plugin contract |
| read/write workspace file asset | workspace file/raw-file path |
| agent tool capability | trusted tool/server path |

## Rule

If the caller says “show/open/focus”, think bridge.
If the caller says “fetch/query/persist/search”, think backend contract.
If the thing is really a file, think workspace file path.
