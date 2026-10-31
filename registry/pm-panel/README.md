# One pluggable PM

The PM uses the regular `AgentWorkspace layout="embedded"`: Tasks, History, Library, New and close. No PM-specific chat chrome or full-page requirement. The host supplies its theme tokens; the retained point/voice composer is the only specialized conversation control.

```tsx
<AppShell {...app} improve={{ agent: 'pm' }} />
// Or, inside any sized container (including Studio):
<PmChat spec={{ controller, conversations, conversationId, resources, chatProps: { actions, locale: 'fr' } }}
  page={pointableAppElement} screen="Ma journée" />
```

`resources` is the existing `AgentWorkspace` contract: `{ endpoint, fetch, identity }`. The one-line resolver uses authenticated, page-relative `api/pm/agent`, `api/pm/conversations`, `api/pm/chat` and the revision route `api/pm/agent` names in `resources.endpoint`, as Studio does. The Library is read-only and the real service lists `documents/`. Dictation stays at `api/host/transcribe`; tasks stay at `_tasks/api`. No host route is added.

A direct chat-only `ImproveSpec` can omit resources and conversations; absent capabilities are not fabricated. For the complete PM, supply both. Artifacts use existing kinds/viewers and `ArtifactWorkspace`: beside chat when the container fits them, otherwise a sheet confined to that PM window with Back to chat. No `PmMockupView`, `pmArtifacts` or `readArtifact` adapter remains.

## Pointing and tasks

`PmComposer`, `usePmPanel`, `PointComment`, `pointMessage`, `PointChipView` and localized `pmTextFor` retain Montrer, the select/navigate strip, voice while pointing, numbered pins, atomic review chips and `pm.points@1` send context. Native summary/details targets remain separate, and policy-filtered image capture uses bounded page budgets instead of the tiny anchor metadata budget. Captures never copy media URLs, canvas pixels or form values. Metadata is an untrusted observation, never approval.

`ImproveSpec.tasks` (`StudioTaskBoardSeam`) takes the existing `{ tasks, currentUser, onOpen, cardActions?, renderRequest?, refresh? }`. Tasks uses existing `PmRequests`: needs-you first, one status chip, Terminées folded. `renderRequest({ entry, edit })` composes through pi-chat's reply footer without replacing native replies. Optional news integration:

```tsx
tasks: {
  ...existingTasks,
  header: <NewsCard {...hostProps} />,
  unread: hostProjectedUnread,
  onOpenChange: open => hostTasksPanelChanged(open),
}
```

The host owns exact-ID acknowledgements; open state is not a durable receipt. Without `unread`, the kit retains its viewer-local shipped-request dot. Closing a viewer releases local UI/capture resources, never admitted work or another consumer's controller. Back goes pointing → chat → closed, not through a deleted intermediate sheet.

## Opening from a host frame

Existing URL: `?agent=improve` (consumed once before shell history entries). For any later open, including after the person closed it, use the same-origin parent protocol:

```ts
frame.contentWindow.postMessage({ boring: 'pm-probe', requestId: 'probe-1' }, appOrigin);
// app -> parent: { boring: 'pm-ready', supported: true, requestId: 'probe-1' }
frame.contentWindow.postMessage({ boring: 'pm-open', requestId: 'open-1' }, appOrigin);
// app -> parent: { boring: 'pm-ack', accepted: true, requestId: 'open-1' }
```

The app also announces `{ boring: 'pm-ready', supported: boolean }` when support mounts/changes. A request ID must be nonempty and at most 128 characters. The app requires both `event.origin === location.origin` and `event.source === window.parent`; replies target that exact origin. The parent must likewise check origin and `event.source === frame.contentWindow`. Cross-origin frames deliberately do not support this protocol. `accepted` means local open intent, not an authenticated/connected PM or a durable task acknowledgement. No microphone, conversation selection or permission is granted.

## Evidence

See [feature map](../../features/pm-panel.md). After building, set `CHROMIUM` and serialize heavy runs:

```sh
node examples/pm-panel/journey.mjs
node examples/pm-panel/journey-annotate.mjs
PM_CASE=rows node examples/pm-panel/journey-annotate.mjs
node examples/pm-panel/journey-present.mjs
node --test test/contracts/pm-*.test.mjs
```

All fixtures are fictional/scripted. Screenshots and raw local evidence stay under `.cache/evidence/pm-one/`; local proof is not a kit release, Studio adoption, deployed-app fix or real-phone-hardware qualification.

## In a host's frame

`?pm=standalone` in a frame: the bar reads « PM », since the host already names the app, and it stays above the viewer at every width. The PM tells the page holding the frames, with no content: `{ boring: 'pm-pointing', picking }` when pointing starts or stops and `{ boring: 'pm-picked' }` when a pick lands. A host showing one frame at a time (a phone) shows the app, then comes back.
