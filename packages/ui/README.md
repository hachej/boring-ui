# @hachej/boring-ui-kit

The root is pure headless ViewerFeature/ViewerController state/actions/tools, typed descriptors and presentation commands. A ViewerRenderer is composed separately. ViewerFeature<Descriptor, Controller> preserves the complete concrete controller, including flush/custom methods. Concrete controllers use cached immutable snapshots and explicit owner teardown; contract-only features require their own implementation. Inline/record viewers need no dummy file client; a document feature closes over the exact resource capabilities supplied by its host.

`@hachej/boring-ui-kit/resources` adds versioned-document and new/existing-buffer save contracts; install its optional `@hachej/boring-files` peer when used. `@hachej/boring-ui-kit/pi` adds ChatSource returning Pi's exact ConversationWatch (including asynchronous operations/backpressure and close reason); install the optional native Pi peer when used. Neither subpath is imported by the root, and @hachej/boring-agent is not a dependency.

`createMarkdownController` from `@hachej/boring-ui-kit/markdown` implements document editing without React or Pi. Supply an authenticated ResourceClient, its expected scope/principal/initiator, a saved snapshot or new-document target, and a stable viewer instance and page epoch. Expected identity is comparison metadata and grants no access. The host must bind reads to that identity. Opening the controller performs no reads or writes.

Call `actions.edit(text)`, then capture `actions.selection()` and pass it to `flush(selection)`. Flush returns saved only for a matching operation digest, exact resource transition and expected receipt identity. Later typing remains dirty. Refresh preserves dirty buffers; `discardToRemote` deliberately discards only edits that existed when it began. Disposing releases listeners and does not close the borrowed client or cancel committed work.

Lost or malformed acknowledgements stay unknown. `actions.reconcile()` uses retained operation lookup and never blindly retries after not-found. Another save waits for acknowledgement or reconciliation. Invalid Unicode is refused before publication. A locally installed Markdown source recipe is available; hosted registry qualification remains pending. Native chat is available through the optional entries described below.

Historical scaffold tests install/typecheck packed headless UI and UI+files in clean consumers without Pi or an agent package. Candidate runtime installation qualification is recorded separately in the [implementation checkpoint](../../docs/implementation/PARTIAL.md). Import interfaces with `import type`.

For read-only content without a resource client or controller, select the lightweight [`artifact-viewer`](#read-only-artifactviewer) entry. It needs only React and Marked, not files, Pi, Tiptap, canvas or pdfjs.

See [scaffold guide](../../docs/contracts/SCAFFOLD.md) and [audit](../../docs/contracts/ABSTRACTION-REVIEW.md).

## Exact proposals and commands

`actions.propose(selection, edits, summary)` retains an immutable proposal with its exact resource/scope/view/revision, viewer instance/epoch, buffer version, before/after text and ordered edits. It performs no publication and preserves existing human text. Every nonempty `find` must occur once; a missing or ambiguous edit rejects the entire transform.

Human `actions.accept(id)` requires the original base still to match, adopts the exact proposed text and flushes that selected buffer through the normal publication path. A changed version remains stale even when the text was edited back. Subscriber edits during adoption prevent that flush; typing during publication remains dirty after acknowledgement. Unknown or pending saves block acceptance until reconciliation. The adopted proposal remains inspectable; `actions.reject(id)` removes only that local proposal. Proposals are ephemeral and do not establish product approval or durable decision state.

The concrete `tools.inspect` and `tools.propose` presentation commands require the full live target and an `expiresAt` timestamp. Inspection reports text, dirty state and save selection. Expired, retargeted or disposed commands refuse. No agent acceptance command is exposed. Native tool registration remains host-owned; `@hachej/boring-agent/documents` independently patches saved Markdown without importing a viewer. `readOnly: true` refuses local edits, proposals, acceptance and flush; provider authorization still controls actual writes.

Behavior follows the pinned v3 Markdown ledger in [LEGACY-UI.md](../../docs/compatibility/LEGACY-UI.md), with exact base checks and v4 transactional saves. Mounted selection and heading commands are available through the optional renderer below. The optional renderer presents proposal line diffs with folded context.

## Optional Markdown editor

Import `MarkdownEditor` from `@hachej/boring-ui-kit/markdown-editor` and pass an existing `MarkdownController`:

```tsx
import { MarkdownEditor } from '@hachej/boring-ui-kit/markdown-editor';

<MarkdownEditor controller={controller} title="Notes" initialMode="rich" />;
```

Install the pinned React, React DOM, Marked and Tiptap peers listed in this package's manifest when selecting this entry. They remain optional for headless consumers. The renderer borrows its controller; unmounting does not dispose it or close its resource client. The host owns selection, identity and teardown.

Formatting defaults to the native Tiptap selection bubble on desktop and phone. The header’s **Formatting** icon toggles the full bar; unpressed means selection-only formatting. It remembers the choice for the viewer session, stays visible on phones with a 48px target and hides in Markdown mode. The **…** menu keeps **Formatted** / **Markdown**. Pass `formattingToolbar="pinned"` for the full desktop row (on phones it docks above the keyboard while editing). The built-in menu supports `locale="fr"`. Installed recipes supply real shadcn Base UI menu items through the optional `components.markdownMenu` binding. Keyboard shortcuts and Markdown input rules remain available. Rich formatting and Markdown source controls share controller state. Mounting, switching modes and projecting remote text never serialize the original buffer. Genuine rich edits serialize the changed block range through Tiptap; untouched source spans are retained verbatim.

Formatted opens documents with YAML front matter, raw HTML/comments, footnotes, reference links, CRLF and style variants (`*` bullets, four-space nesting, underscore emphasis and setext headings). Front matter is an editable literal code block. HTML and definitions are quiet raw blocks; inline HTML and references are inert source atoms, never executable HTML. A save without editing preserves the original bytes. Paragraph/heading/list-item source metadata also keeps unchanged spelling through edits and native undo. Edited content follows its existing heading style and document markers where valid; intraword emphasis uses stars when underscores would change its meaning. CRLF is edited as LF and restored on write. The existing legacy `&nbsp;`-only paragraph cleanup remains.

Mixed line endings, bare carriage returns, NUL characters and blocks whose native projection cannot retain verified source spans still open in Markdown source with a specific explanation. `checkMarkdownRichSafety` reports that decision. Provider save, conflict and recovery semantics are unchanged.

Autosave is enabled by default after 1200ms of idle editing and flushes on blur and page hide through the existing conditional `controller.flush`. Untouched new buffers are not automatically published. `autosave={false}` restores explicit Save; `autosave={{ delayMs: 500 }}` changes the idle delay. Ctrl/Cmd+S always saves the exact selected buffer explicitly. Refused, conflicting and unconfirmed saves retain the draft and pause automatic retries until resolved.

Use `onAutosaveChange` to register the mounted flush barrier. Await that flush before closing, unmounting or disposing the controller. If it returns false, keep the editor mounted with its refusal/conflict UI unless a real host navigation guard obtains deliberate discard consent. Internal flush registration is not a discard guard. Unmount cleanup and browser page hide are best effort, not substitutes for awaiting the owner teardown barrier. See the [registry recipes](../../registry/README.md) for `MarkdownPane`, viewer-window policy and navigation integration.

Proposal review shows added/removed lines with two lines of context and expandable unchanged runs. It preserves exact line endings and marks a missing final newline. An inner details panel retains exact before/after text. Accept and save delegates to the controller; reviewing or expanding context never publishes. Conflict and unknown outcomes expose explicit discard or reconciliation controls.

Detailed alignment uses a matrix of at most 250,000 cells after trimming equal prefix/suffix lines. Larger comparisons show all removed/added middle lines with an explicit notice. This bounds the comparison matrix, not total document size, string-comparison cost or rendered rows.

The rich view offers a Document outline built from the native parsed headings when `showOutline` is true. By default, the option follows the built-in `header` visibility; the outline stays hidden until **Show outline** is checked in the menu. Navigation changes the native selection without editing or saving Markdown. Rich/source switches retain each mode's selection and direction while the buffer version is unchanged. Text projected from outside (load, refresh, discard, source edits) puts the rich selection at the document start, where the browser leaves its caret, so a click or formatting command never acts on a stale selection at the end. External replacement or source edits invalidate older bookmarks; changing controllers starts a new local session. Human heading controls use the mounted presentation command described below.

### Mounted Markdown commands

Pass `onMountedTools` to receive a concrete `MarkdownMountedTools` handle, or `null` when detached. Callback replacement receives the same live handle. `getTarget()` returns the current target only when the mounted projection matches the controller. Capture that target with the request. Native registration stays host-owned; a normal native tool can invoke a captured command with its native abort signal. The headless controller retains its original type and tools.

| Command | Input beyond `expiresAt` | Applied value |
| --- | --- | --- |
| `inspect` | None | Exact save selection, dirty state, headings, current selection and selected text |
| `select` | Rich `{kind: 'rich', anchor, head}` or source `{kind: 'source', start, end, direction}` | No value; confirms actual native/DOM selection and focus |
| `revealHeading` | Zero-based heading `index` from inspection | No value; selects and scrolls to that heading in rich mode |

Rich coordinates are native ProseMirror positions. Source offsets count UTF-16 code units; `direction` is `forward`, `backward` or `none`. Inspection does not return the entire document as selected text. Source inspection has no headings, and source heading navigation returns `unavailable`. Duplicate heading text has distinct indices bound to the current projection.

Commands bind controller instance/epoch, scope, resource/view/base, buffer version, mode, mount and projection identity. An old handle becomes unavailable after unmount or mode change; a serialized old target passed to a replacement handle is stale. Expired requests are stale, cancellation and invalid selection ranges are denied, and missing headings are unavailable. Malformed schema input throws `TypeError`. Selection/navigation use cancellable animation frames; teardown or expiry settles pending work even when a frame never runs.

Read-only documents still support inspection and navigation. These commands do not edit or publish. Reentrant focus/selection handlers can invalidate a request; the command then refuses without restoring old state over newer work. A refusal can follow transient presentation effects. The host must authorize tool exposure and transport separately. DOM and in-process native tests do not qualify browser scrolling, remote authentication or command transport.

The default schema includes headings, lists, task lists, quotes, code and text marks. Raw Markdown HTML is literal text, unsafe link protocols are refused by Tiptap, and links do not navigate on click. There are no asset-loading extensions; embedded assets remain separate work. GFM tables are rich: a table whose cells are unchanged is written back in its original text (unpadded `|a|b|`, `:---:` alignment rows, `_emphasis_`, code, links, escaped pipes, empty cells), so such documents pass the rich-safety round trip; an edited table (cell, row, column) is written as padded GFM keeping each column's alignment. The host can supply `className` and its own styles. The [Markdown source recipe](../../registry/README.md) adds scoped default styles and has a real local shadcn installation/restyle test. Hosted registry and browser qualification remain pending.

`test/packages/ui-markdown-editor.test.mjs`, `test/packages/ui-markdown-navigation.test.mjs` and `test/packages/ui-markdown-mounted.test.mjs` and `test/packages/ui-markdown-proposals.test.mjs` drive the real React/Tiptap renderer, DOM selections and SQLite provider. `npm run test:editor-consumer` requires `npm_config_cache` pointing to a writable cache with the pinned archives; it installs actual package tarballs, checks declarations with `skipLibCheck: false`, drives the controls and bundles for browsers without Pi or server filesystem imports. These checks do not establish browser layout, caret, IME or accessibility qualification. Chromium journeys remain pending.

## Optional microphone capture

`createVoiceCapture` from `@hachej/boring-ui-kit/voice-capture` records browser audio without React, files or Pi. Call `start()` from a person's gesture. It feature-detects microphone access and returns a recording or a typed refusal. `stop()` returns the Blob, recorded MIME type, page-clock sample times and `truncated`; `cancel()` discards audio and releases only this capture's microphone tracks, including a permission request that finishes late.

Where the page has Web Audio, the recording is a 16 kHz mono 16-bit WAV (`audio/wav`, 32 kB/s), not MediaRecorder's webm: a webm carries the browser's clock, and one whose timestamps jumped was refused by every OpenAI transcription model. `start()` resolves `recording` once the first sound arrives, so a host showing "recording" never loses the first words; no sound within `firstSoundMs` (5 s) refuses as `busy`. A context the browser keeps suspended (no user activation, e.g. a hold begun on `touchstart`) records that take with MediaRecorder as before; `audioContext: null` always does. `encodeWav` and `downsample` are exported.

`progress()` returns current elapsed milliseconds, PCM RMS level, paused state and pause capability (null outside a capture). `pause()`/`resume()` return false when unavailable/ended. PCM pause keeps the microphone open but stops appending frames: elapsed time and WAV duration exclude paused samples. MediaRecorder fallback exposes no level or pause, never fabricated telemetry.

`maxMs` caps captured audio at five minutes by default. Reaching the cap stops the microphone; callers still choose when to consume the recording through `stop()`. Transcription and persistence remain host capabilities. The existing `@hachej/boring-feedback/page` capture API re-exports this implementation unchanged. The headless root imports neither entry.

The [registry voice-message guide](../../registry/README.md#voice-messages-in-pi-chat) describes PiChat's optional tap-to-record composition. Public capture behavior runs in `test/packages/ui.test.mjs`, compatibility in `test/packages/feedback-voice.test.mjs`, and dependency-free installation in `test/scaffold/isolated-ui.test.mjs`.

## Document marks

`@hachej/boring-ui-kit/markdown-quote` exports `captureMarkdownQuote` and
`markdownQuoteResolution`: pure exact-only anchors over canonical Markdown source.
`@hachej/boring-ui-kit/mark-store` exports the kit's sidecar store, independently of
React, Tiptap and Pi execution:

```ts
import { createMarkStore } from '@hachej/boring-ui-kit/mark-store';
import { captureMarkdownQuote } from '@hachej/boring-ui-kit/markdown-quote';

const store = await createMarkStore({ client, identity }, locator);
const capture = captureMarkdownQuote(source, { start: 0, end: 12 });
if (capture.kind === 'captured') {
  await store.add({ id: 'mark-1', anchor: capture.anchor, colour: 'accent',
    note: 'A fictional comment.', author: identity.principalId, time: new Date().toISOString() });
}
await store.edit('mark-1', { note: 'Revised fictional comment.' });
await store.remove('mark-1');
store.dispose(); // Does not close the borrowed resource client/provider.
```

Use the same workspace `client` as the document. `identity` is expected receipt
metadata, never browser authentication. The store reads `<doc>.marks.json` in the
same view and writes it only through the existing conditional publication path.
`getSnapshot`/`subscribe` provide immutable marks, dirty/lifecycle and save state;
mutations return the exact existing `SaveResult`. A stale tab retains its local
marks and returns conflict; `reload()` explicitly discards them. Lost replies
require `reconcile()` on the original operation. No auto-merge or blind retry is
performed. The host owns policy, attribution and recovery after missing receipts.
The [owner](../../docs/architecture/FEEDBACK.md#markdown-quotes-and-document-marks)
defines quote/context matching and conservative rich-projection limits.

The existing `MarkdownEditor` accepts `highlights`, `onQuoteSelection` and
`onHighlightActivate`. Native decorations leave the document buffer clean. Rich
capture refuses anything outside one proven literal text leaf; source selection
remains available for syntax, escapes or normalization. The `highlights` registry
block supplies context actions, comments and an unplaced-mark tray, creating a
store by default or borrowing the same `MarkStore` interface from an app.

## Optional native chat

The `/native-chat` entry also owns the neutral `ChatController`/`ChatSnapshot` renderer types. Concrete native controllers retain their full APIs. Optional multi-party data (`ChannelSource`, `createSharedChat`, socket/fake sources and state types) stays exclusively at `/shared-chat`, not the headless root. Its presentation is the optional [`shared-chat` registry item](../../registry/README.md#regular-chat-or-shared-chat); regular `pi-chat` has no imports from it.

`createNativeChatController` from `@hachej/boring-ui-kit/native-chat` borrows an actual native `Conversation` and host-bound `Context`. Supply explicit runtime, scope and principal identity. These labels select a presentation instance and grant no permission. The concrete `controller.conversation` keeps the full native API available. `connect()` owns one native watch, and `dispose()` asynchronously closes that watch without aborting tasks or closing the borrowed Harness.

`setText`, `setAttachments` and `send` retain an immutable selected draft. `beforeSubmit` validates that selection before the first submission and every retry. A refused retry retains the original unknown attempt. Native authorization remains the host boundary's responsibility. A thrown admission stays unknown unless the host can prove it was not admitted. `reconcile()` looks up the original native request. `retrySameRequest()` uses its original request ID and content, including when the user has since edited the composer. `send()` empties the composer at once, like any chat app: the sent text is held by the controller as the pending submission, so text typed before the host confirms is a new draft, never appended to the sent one, and an acknowledgement never clears it. Sending again while a submission is still being confirmed queues the new message in `outbox` and submits it, in order and with its own request ID, once the previous one is admitted. A refused message (validation, or a submission the host proves was not admitted) and any messages waiting behind it go back into the composer, one per line, ahead of the text typed since. A submission whose outcome is unknown stays held for `reconcile()`/`retrySameRequest()`, and further sends are refused until it is resolved. `send(whenBusy, { text, attachments, restore })` sends explicit content without touching the composer (`restore` is what comes back on refusal). This controller retains uncertainty in memory; durable reload of an unacknowledged local draft is not implemented.

The full native `ConversationView` stays available in memory. Remote hosts must separately authorize and redact data before transport; this entry does not replace the authenticated projection boundary (`@hachej/boring-agent/chat-transport` applies the host's `project` to the watch, history pages and submission lookups). The presentation layer is the `pi-chat` registry item ([registry README](../../registry/README.md)); this package ships the headless controller only.

A submit the host refused before admission (status 402 `submission-refused`, for example a metering refusal from `@hachej/boring-agent/metering`) rejects with `SubmissionRefused` carrying the host's message; `remote.definitelyNotAdmitted` recognizes it, so a controller given the spread remote chat shows it as a blocked send (`send.kind === 'blocked'`) with the draft kept, instead of an unknown submission.

`@hachej/boring-ui-kit/remote-chat` releases its watch stream while the page is hidden (`document.visibilityState`) and reopens it when the page is visible again, because browsers cap concurrent HTTP/1.1 connections per host and one idle stream per background tab starves every other request. The reopened watch starts with a complete view, so the controller keeps reading `connected`; submissions, answers and running turns are separate requests and are unaffected. The watch also survives the network: a stream that ends without an end frame (a proxy or load balancer closed it), or stays silent for 2.5 of the server's announced heartbeat intervals, is reopened with exponential backoff (`reconnect: { baseDelayMs: 1000, maxDelayMs: 30000 }`, with jitter) until the controller stops it. Meanwhile `remote.link` reports reconnecting and a controller given it (spreading the `RemoteChat` into its options does) reads `connection.kind === 'reconnecting'`; the reopened stream starts with a complete view, so nothing is duplicated. A refusal (4xx) or a final end (`retired`, `stopped`, revoked) ends the watch instead. Pass `pauseWhenHidden: false` to keep the stream open, and always call `close()` on a `RemoteChat` the controller never claimed. Node and workers have no `document` and are unaffected.

`submissionStatus(submission)` reads that exact native handle using the controller's host-bound Context, verifies its conversation and rejects after disposal. It adds no lifecycle or retry: use native `done.answer` to attribute a response, rather than matching text or assuming the next assistant row belongs to a send. The optional [point-and-dictate block](../../docs/guides/agent-target.md) uses it while chat stays closed.

`test/packages/ui-native-chat.test.mjs` uses a real native Harness and a fictional local streaming provider.

### Chat view rules

`@hachej/boring-ui-kit/chat-view` holds the chat's presentation rules once, so the registry items (`pi-chat`, `pi-ambient`) keep only their markup. It imports Pi types only: no React, no files or agent code. `derive(view, options)` turns a native `ConversationView` into display rows (cards, activity steps, questions, approvals, artifacts) and the run state; its card content type is generic, and the items fix it to React nodes. `waits(part)`, `waitingPart(rows)` and `waitingForAnswer(rows)` are the one rule for "waiting for the person": a committed question with no result, or an approval with no result and no decision (a decided approval is not waiting). `preparing(...)` is when the natural presentation's single status shows. `pendingNotice` and `finishNotice` give the words of the run toasts and system notifications from one table, `defaultNoticeText`, which a surface can replace to localize them. Evidence: `test/packages/ui-chat-view.test.mjs`.

`@hachej/boring-ui-kit/chat-text` holds the chat's text grammar once: pure string functions, no React, files or agent code. `mentionToken(value)` writes an `@` mention (quoted when the value has whitespace, a quote or a backslash) and `mentionedPaths(text)`, `MENTION_TOKEN` and `pieces(text, options)` read mentions back, with the same parser as `mentionedPaths` of `@hachej/boring-agent/mentions`; `hasMention` and `removeMention` edit a draft; `slashItems`, `slashGroup` and `slashQuery` drive the `/` menu, `mentionTrigger` the `@` picker. `appendToDraft(draft, text)` adds text at the end of a draft with one space, and `prependToDraft(draft, text)` puts a refused message back on its own line before it. `fileKind`, `isUploadPath`, `isVoicePath`, `displayName`, `visibleParts`, `isLongPaste` and `looksLikeMarkdown` classify attachments and pastes. The shared chat writes and finds member mentions with it (`memberMention`). `kindMentionDraft(text, { kinds })` projects editable composer text plus its hidden kind-token spellings from the full native draft, leaving file tokens visible. `writeKindMentionDraft(text, tokens)` prefixes complete hidden tokens before editable text so unfinished quoted input cannot consume them. `mentionKind(value, { kinds })` resolves an app-registered `prefix:path` token without depending on its renderer; `withoutMentions(text)` consumes all tokens for voice sends, while `withoutKindMentions(text, { kinds })` drops only registered app tokens from refused-message restoration. See [App mention kinds](../../registry/README.md#app-mention-kinds) for the React config. Evidence: `test/packages/ui-chat-text.test.mjs`.

`@hachej/boring-ui-kit/chat-react` provides `useRunNotifications(controller, store, options)`, `watchConversation(controller, store, options)` and `createNotificationStore()`. Both adapters use one transition over the existing controller's `subscribe`/`getSnapshot`, with no execution lifecycle ownership. `options` supplies `conversationId`, `title`, `question(call)` and optional localized `text` (`NoticeText`); `enabled`, `suppress()` and `onOutcome()` are optional. Questions notify even without a run; approval decisions dismiss input notices; disconnected snapshots neither complete work nor consume transitions. The first connected observation establishes a baseline (and reports pending input), never invents a past completion. Suppression consumes a transition without pushing a toast. Detaching releases only the subscription. The store is transient presentation, not durable delivery. This is host UI policy over native views, not a Pi execution extension. Existing registry notification exports remain available. Evidence: `test/packages/ui-run-notifications.test.mjs`.

`chat-view` also owns artifact descriptors and parsing (`parseArtifact`, `detectArtifact`, `recogniseArtifact`), `pendingPresents` and `createPresentAcks`. `artifactVersions(view, detect?)` lists newest conversation results first, even when retried calls reuse an ordinal. `follows(descriptor, versions)` compares the newest revision for that artifact key. `collectArtifacts` remains oldest first for compatibility.

`@hachej/boring-ui-kit/chat-react` is opt-in React presentation over the existing `ChatController.subscribe/getSnapshot` seam, never a Pi executor or a second store. `useArtifactFollow` takes the controller, conversation ID, active descriptor/follow selection and host opening/guard callbacks. It returns versions, `open`, `isOpen`, `select`, `recordClosed` and viewer `onShown`/`onFailed` callbacks. Initial artifacts do not auto-open; new ones may when `autoOpen` is enabled (default false), unless the host reports a narrow screen, unsaved work or a close in this turn. Call `recordClosed` only after the host's leave guard accepts. A present is acknowledged with only the revision the viewer reports after it loads and mounts; unmount reports use `hidden: true`, failures refuse, and absent reports stay unconfirmed. Controller/conversation changes fence old reports and retries. The host retains its controller and execution lifetime. Evidence: `test/packages/ui-chat-react.test.mjs`, `test/packages/ui-present-ack.test.mjs`.


### Native conversation history

`loadEarlier()` reads one native page through `Conversation.entries`. `snapshot.history` distinguishes disabled, idle, loading, ready and error states. Each request contains at most 40 native entries. The controller accumulates pages in display order for the person's current browsing session and retains an opaque native continuation cursor. It clears that cache on history invalidation or `clearHistory()`; loading never restores records to model context. The first request captures the greatest observed active entry ID as an inclusive upper bound; later writes do not move that bound. Parent-owned fork entries remain valid native history.

A failed read retains the previous page and continuation for retry. `clearHistory()`, head or non-append active-range changes, reconnect, watch closure and disposal invalidate pending responses. Clearing a page does not cancel native work or promise remote read termination. The controller preserves the exact host Context. Page-count limits do not bound message bytes or native storage allocation.

Without a custom `source`, history defaults to the borrowed conversation. Set `history: false` to disable it. With a custom source, history is disabled unless the host supplies an explicit `{ id, entries }` native capability for that conversation. The ID must match before and after a read. Hosts remain responsible for current authorization and must dispose or disconnect presentation when its scope is revoked. Expert mode is not redaction.

`test/packages/ui-native-chat-history.test.mjs` uses real native reset/head/fork records. `node fixtures/chat-history.mjs` demonstrates three native pages across a reset without model calls.

## Headless canvas document edits

Import `parseCanvasDocument`, `applyCanvasEdits`, `CanvasEdit` and `canvasMediaType` from `@hachej/boring-ui-kit/canvas-document`. Pass the host's native `TLStoreSchema`. This entry needs neither a mounted editor nor a resource client. It preserves the selected schema and refuses migrations, unsupported shapes, assets and session records.

`parseCanvasDocument(value, schema)` returns a detached, complete native document or throws. It validates native records, document/page presence, parent chains, arrow endpoints, page membership and unique arrow terminals. It performs no normalization or repair.

`applyCanvasEdits(document, edits, schema)` returns `{ kind: 'applied', document }` or `{ kind: 'rejected', reason }`. Each edit is one of:

- `{ kind: 'create', record }`: create an absent native shape or arrow binding.
- `{ kind: 'update', record }`: replace an existing record of the same native type. Supply the complete record, including `props` and `meta`. Coordinates are local to its supplied parent.
- `{ kind: 'remove', id }`: remove an existing shape or binding. Shape removal also deletes descendants, arrows attached to removed shapes, and their bindings. Removing a binding alone preserves both endpoint shapes.

A batch may refer to records created later in that batch. Duplicate edits to one ID, missing targets, invalid final graphs and writes removed by the batch's deletion cascade reject the whole batch. Inputs are unchanged. Returned records are detached from the caller's inputs.

The caller publishes the candidate through its existing conditional resource operation against the original revision. These functions grant no authority, publish no bytes and promise no native Editor side-effect or geometry equivalence. Local proposal review/adoption remains separate work.

## Optional canvas document controller

Import `createCanvasController` from `@hachej/boring-ui-kit/canvas`. Supply a borrowed native `TLStore`, an authenticated resource client, a saved snapshot or new target, expected identity and viewer instance/epoch. Install the pinned `@tldraw/editor` and `@tldraw/store` peers and their React peers. The SDK itself depends on Tiptap; selecting canvas does not import Boring's Markdown renderer. Plain Markdown/chat imports remain independent of canvas.

For saved sources, use an empty native store or one whose document already matches that source. Construction refuses a different existing document to protect another viewer's draft. Edit through the original `controller.store` API. Capture `controller.actions.selection()` and pass it to `controller.flush(selection)`. Only a matching publication receipt advances the saved base. Late acknowledgements preserve newer shapes. `refresh` preserves dirty work; `discardToRemote` discards only the version selected when that read began. `reconcile` uses the original operation identity after an uncertain acknowledgement. Camera, selection and other session records remain local.

Incoming documents require `application/vnd.tldraw+json`, valid UTF-8/JSON, the exact native schema version and supported document records. Assets, custom shapes/bindings and migrations are not yet qualified. A native host can still insert unsupported working records through its borrowed store; the controller reports `problem` and refuses selection/publication until corrected. `readOnly` denies controller publication without changing shared native-store permissions. The owner must configure any rendered editor's read-only behavior separately. Disposal releases owned listeners, not the store or resource client.

`npm run test:canvas-consumer` installs actual library tarballs and pinned registry dependencies, type-checks a strict consumer, repeats public native-store/SQLite tests and bundles for browsers. Supply a writable `npm_config_cache` containing those archives. Tests use a DOM animation scheduler and the SDK's supported test mode. Default Node imports retain the SDK's user-sync BroadcastChannel; no server lifecycle guarantee is claimed. Browser journeys, CSS/egress, asset policy and production licensing remain pending under the [canvas owner](../../docs/architecture/CANVAS.md). No license is purchased or provisioned by this package.

Canvas consumers set `skipLibCheck: true`, as tldraw apps do. The pinned SDK's own declarations do not check strictly: `@tldraw/utils` imports `lodash.isequal`, `lodash.isequalwith`, `lodash.throttle` and `lodash.uniq` but lists their `@types` only as its devDependencies, and the full SDK's `ArrowShapeUtil.onHandleDrag`/`onTranslateStart` overrides are incompatible with their base under `exactOptionalPropertyTypes`. Neither is a pinning mismatch; both are in tldraw 5.5.2's published declarations. The consumer's own code still checks with `strict` and `exactOptionalPropertyTypes`, and the consumer script reruns with `--skipLibCheck false`, failing on any diagnostic outside `tldraw`/`@tldraw/*` declarations, so Boring's declarations stay library-checked.

Native document author records are preserved. They do not grant access or select publication identity. Nonempty author image URLs are refused until the host asset adapter is qualified. Mounting the native editor may add author metadata and make the draft dirty; it does not save automatically.

`test/packages/ui-canvas-editor-lifecycle.test.mjs` mounts the actual native `TldrawEditor` in a DOM environment, including React StrictMode. Unmount leaves the concrete controller and an independent native history listener active; subsequent raw loads/puts can still publish through exact saves. Remount preserves the document without implicit publication. Fonts, geometry, browser input and the final Boring renderer are not qualified by this bare-editor test.

## Optional React canvas editor

Import `CanvasEditor` and `CanvasAssetUrls` from `@hachej/boring-ui-kit/canvas-editor`. Install the pinned `tldraw` peer in addition to the canvas controller peers. Supply `controller`, a complete host-owned `assetUrls` map, and optionally `title`, `height`, `className`, `licenseKey` and the native `onMount` callback. The native JavaScript and `tldraw/tldraw.css` load lazily, only when a canvas mounts, so the host does not import the stylesheet itself. Asset URLs must cover all pinned fonts, icons, translations and embed icons, so omitted values cannot silently select default CDN assets.

**Self-hosted assets (host recipe).** Install `@tldraw/assets` at the same pin as `tldraw`, serve its package directory at one origin path (for example `/tldraw-assets`), and build `assetUrls` from `tldraw`'s own defaults with that origin in place of `https://cdn.tldraw.com/<version>`. The working example is [`examples/canvas-assets`](../../examples/canvas-assets): `self-hosted.mjs` is the map, `route.mjs` the route, and `journey.mjs` drives Chromium to prove that the canvas makes no request off the host origin and records no Content-Security-Policy violation (`npm run canvas-assets:journey`). Pass `licenseKey` from the host's own configuration, never a literal in source.

The native toolbar and Save/Check saved version controls use the concrete controller. Lost acknowledgements expose Check save outcome; conflicts preserve local edits and expose explicit discard. Paste/import/upload handlers are disabled until asset/content policy is qualified. Mounting may create native author metadata, but never publishes. Unmount preserves the controller and the native session read-only flag. The host explicitly resets or derives that flag when selecting a later writable session. Use one native editor per store; existing host read-only state remains effective.

Run `npm run test:canvas-editor-consumer` for the selected renderer's tarball recipe, actual native/SQLite DOM tests and browser bundle. It uses the same `skipLibCheck` recipe and library-checks Boring's declarations as above, so only the upstream lodash and `ArrowShapeUtil` declaration diagnostics are tolerated. Fictional font/network test boundaries do not qualify browser geometry, real fonts, CSS, egress or production licensing. See the [canvas owner](../../docs/architecture/CANVAS.md).

## Canvas proposals

`controller.actions.propose(selection, edits, summary)` validates complete native-record edits against the exact selected draft. It retains immutable `before` and `after` documents without changing the borrowed store or publishing. `state.proposals` exposes the review candidates. `actions.accept(id)` adopts a still-current candidate and flushes its actual buffer version. `actions.reject(id)` dismisses it without publication. Reentrant edits, stale bases, pending saves and unknown save outcomes prevent a second publication; later acknowledgements preserve newer drafts.

`controller.tools.inspect` and `controller.tools.propose` are ordinary expiring presentation commands. The host supplies authorization when adapting them through `@hachej/boring-agent/presentation`. Browser hosts should use the mounted proposal command below to bind the native page and mount as well.

`CanvasEditor` displays changed record fields, including deletion cascades, with escaped JSON Pointer paths. **Accept and save** is a human action. Native read-only mode disables acceptance. Dismiss never publishes. An adopted proposal remains labelled as applied locally; the save status reports publication separately. After an unknown result, reconcile the operation before retrying. **Keep draft and refresh** calls `actions.abandon()` to leave the unconfirmed save behind while retaining local content. It never reports the old operation as saved or replays it.

`npm run canvas:journey:proposals` drives desktop and phone review controls against authenticated fictional HTTP resources and SQLite, including reload, stale edits and delayed acknowledgements. Its native shape edits use the actual Editor API; it does not qualify pointer drawing, real fonts, licensed assets or production egress.

## Mounted canvas commands

Pass `onMountedTools` to `CanvasEditor` to receive `CanvasMountedTools`, or `null` on detach. Capture `tools.getTarget()` before submitting a command. Its resource, revision, buffer version, viewer instance, mount and native page must still match at invocation. Callback replacement retains the live handle; unmount invalidates it. The controller and store remain borrowed.

- `inspect.invoke(target, { expiresAt })` returns the exact save selection, dirty flag, current-page native shapes, selected IDs, camera and viewport. Returned data is a detached frozen snapshot.
- `select.invoke(target, { expiresAt, shapeIds })` selects existing shapes on the captured page. Duplicate IDs normalize; an empty list clears selection. Missing or other-page IDs refuse before changing selection.
- `frame.invoke(target, { expiresAt, shapeIds })` immediately frames the shapes' combined native page bounds. It requires a nonempty list and visible geometry, respects camera locking and constraints, and verifies actual viewport containment before reporting applied.

`expiresAt` is an absolute millisecond deadline; pass the native abort signal as the third argument when composing `@hachej/boring-agent/presentation`. Inspect, select and frame work with read-only and dirty documents and never publish. A target change during a reentrant native callback refuses the result, but does not promise rollback of intermediate session effects. Saved-resource edits and remote browser delivery remain separate operations.

Mounted `tools.propose` accepts the same complete edits as the headless command and retains the selected page/mount target. It refuses native read-only mode and rechecks cancellation, expiry and targeting before returning a proposal. It never accepts or publishes on the agent's behalf.

`test/compatibility/canvas-mounted-native.test.mjs` composes selection and proposals with real native ToolTasks. `npm run canvas:journey:commands` requires `CHROMIUM` and permitted loopback sockets; it checks real desktop/phone viewport geometry with fictional assets. Production fonts, licensing, egress and CSS isolation remain separate qualifications.

## Read-only ArtifactViewer

```tsx
import { ArtifactViewer } from '@hachej/boring-ui-kit/artifact-viewer';

<ArtifactViewer name="fictional-guide.md" mimeType="text/markdown" content="# Fictional guide" />;
```

`ArtifactViewerProps` accepts `name`, `mimeType`, optional `content: string | Uint8Array`, `url`, `className` and `renderPdf`. Install the existing optional React and Marked peers when selecting this entry. It has no ResourceClient, controller, editing, syntax highlighter or agent integration. The host supplies authorized content and owns URL access policy and layout; mounting grants no file or execution authority.

Normalized MIME selects Markdown, HTML, images and PDF, with filename fallback. Other text/code is an escaped `<pre>` without highlighting. Byte text requires valid UTF-8 without NUL; leading U+FEFF is preserved. Binary audio/video does not become a text preview. Missing or unreadable content displays “Preview unavailable.” Replace byte arrays when changing content rather than mutating them in place.

Markdown uses a private Marked parser, then the same passive HTML allowlist as `HtmlViewer`. Both HTML types render in an empty-sandbox, no-referrer iframe with the fixed restrictive CSP. Links become spans; scripts, attributes, styles, images and external resources are omitted, including Markdown images. The [HTML preview limits](#optional-html-source-and-preview) apply; Markdown input is also limited to 262,144 UTF-16 units before parsing. There is no raw HTML fallback. URL-only Markdown, HTML and text are unavailable: the entry never fetches or embeds them unsanitized.

Images use `<img>` and PDFs use the browser's native sandboxed iframe. `content` takes precedence over `url`; content creates an owned Blob URL, revoked on replacement or unmount. Host URLs are borrowed and never revoked. Relative, HTTP(S), blob and matching image/PDF data URLs are supported; other URL schemes are refused. Supply `renderPdf: (props: ArtifactPdfProps) => ReactNode` to use a trusted host renderer instead, receiving the current `{ name, url }`. The entry does not load pdfjs. Browser-native PDF support and sandbox restrictions vary by browser; it provides no page controls or PDF text extraction.

`test/packages/ui-artifact-viewer.test.mjs` renders fictional fixtures through the built public entry and checks its browser import graph. `npm run test:artifact-viewer-consumer` installs the kit tarball with only React/Marked and test tooling, checks strict declarations, repeats those DOM tests and bundles without files, controllers, Tiptap, canvas, pdfjs or agent code. DOM structure tests do not qualify browser CSP enforcement, parser inertness, egress or native PDF rendering.

## Optional HTML source and preview

Both `MarkdownEditor` and `HtmlViewer` accept optional `components` bindings for host buttons, inputs, textareas and the selection bubble. Installed registry recipes supply the consumer's unchanged shadcn components. Bindings forward refs and native input events. Omitting them retains unstyled native HTML for direct package consumers; it is not installed-block design qualification. See the [registry theming contract](../../registry/README.md#styling).

Import `createHtmlController` and the concrete `HtmlController` from `@hachej/boring-ui-kit/html`. Import `HtmlViewer` from `@hachej/boring-ui-kit/html-viewer` only when selecting the React renderer. These entries need no agent, native environment, Tiptap or canvas runtime. The headless controller accepts the same resource identity/client and new or saved source shape as the Markdown controller. Saved resources must be `text/html` with valid UTF-8.

`actions.edit`, `actions.selection` and `flush(selection)` preserve exact source bytes through the existing conditional publication contract. Refresh preserves dirty text, discard is explicit, and reconciliation handles lost acknowledgements without another write. Late saves retain later edits. The concrete controller has no mounted HTML tools; the native document tools remain Markdown-specific. Unmount borrows the controller and never saves or disposes it.

The renderer offers HTML source and preview modes with Save, Refresh, Reconcile save and Discard local edits controls. Preview uses a detached native template and reconstructs fixed HTML formatting elements with escaped text. It removes attributes and discards active, custom, foreign and template subtrees. Links become spans. The generated document has a fixed CSP, an empty iframe sandbox and no-referrer policy. Original nodes are never inserted or adopted. Preview intentionally omits scripts, styles, forms, images, embeds, navigation and external resources; saved source remains exact.

Preview refuses source beyond 262,144 UTF-16 units, traversal beyond 20,000 visited nodes or depth 128, and output beyond 1,048,576 units. Traversal/output limits do not bound peak allocation inside the browser parser. A parser or Trusted Types refusal leaves source viewing and saving available. No permissive Trusted Types policy or raw preview fallback is created. Server rendering does not parse or embed generated markup.

Run `node fixtures/html-document.mjs` after building for a fictional authenticated resource save. `npm run test:html-consumer` installs isolated tarballs, checks strict concrete declarations, repeats controller/DOM tests and bundles both entries without native/server or heavy viewer implementations. `npm run test:html-registry-consumer` uses the actual shadcn CLI and drives the copied source recipe before and after restyling. These DOM checks do not qualify native parser inertness, iframe/CSP/Trusted Types security, browser input or network isolation. The attempted Chromium journey currently fails at startup under sandbox EPERM. Browser qualification remains open.

## Optional fixed and derived experiences

Import `validateExperience` from `@hachej/boring-ui-kit/experience/compose` and `Experience` from `@hachej/boring-ui-kit/experience`. Install exact optional peers `@json-render/core@0.21.0`, `@json-render/react@0.21.0`, `zod@4.6.5` and React 19.3.0. The validation entry loads no React runtime, files, Pi or agent. The renderer uses the native json-render catalog, registry, providers and renderer.

Descriptors use format `boring.experience`, version 1 and source `fixed`, `derived` or `generated`. Generated output comes through the optional composer below. The current installed layout kinds are `boring/stack`, `boring/row`, `boring/grid`, `boring/cell` and `boring/generated`, all version 1. Stack/row accept gap `small`, `medium` or `large`, defaulting to medium. Grid adds integer columns from 1 through 4. Cell props contain only a `ref` in `app/cell` form. Every used cell kind/version must appear in the descriptor's `kinds` map. See `fixtures/fixed-experience.mjs` for a complete descriptor.

The host supplies `cells` with `ref`, `kind`, `version`, optional `maxUses` and a stable `render` React component. That component closes over its concrete controller and owning application's operations. Descriptor props and action parameters never reach it. Default maxUses is 1. Registration accepts only one version per kind and one cell per ref. `canView(ref)` is a synchronous host policy callback and must return literal true. The host rerenders Experience when its authorization or cell registrations change. The library checks access again in the cell renderer; unavailable cells show a placeholder. Each host action must still authorize when invoked.

`validateExperience(value, { cells, canView })` returns a detached frozen descriptor or throws. It checks strict per-kind props in addition to native catalog validation, compatible versions, current visibility, connected tree structure, cell counts and bounds. Limits are 200 elements/kinds and depth 24. IDs inherited from Object.prototype are refused because the pinned native renderer caches their signatures incorrectly. Validation does not render cells or execute their operations. Bounds on accepted descriptors do not bound parsing allocation for arbitrary trusted local input.

For a host that owns explicit adoption, `ExperienceRenderer` is also exported from `@hachej/boring-ui-kit/experience`. Pass a descriptor returned by `validateExperience` or the concrete experience controller. It renders the accepted descriptor directly and rechecks each cell's current access. It does not validate arbitrary input or add another acceptance prompt. The host owns asynchronous pre-adoption checks and must rerender when access changes.

Experience initially renders the validated layout. A changed descriptor offers Use proposed layout and keeps the current one until acceptance. Invalid proposals leave the current layout intact. An initially unavailable descriptor can be offered after host access or registration becomes available. Explicit acceptance can remount rendered controls; their external controllers remain borrowed and retain dirty text. Unmount never saves or disposes them. Stable host renderer functions avoid incidental React remounts on ordinary rerenders. Browser focus/selection preservation requires separate qualification.

This first implementation refuses descriptor actions, state expressions, bindings, visibility expressions, watches, repeats, slots and unknown fields. The native provider has built-in actions even without user handlers, so an empty action registry alone would not enforce that boundary. Full named-action routing and live evaluator integrations remain required roadmap work. Arbitrary custom layout schemas are not yet installed by this API.

Run `npm run test:experience-consumer` with the writable pinned npm cache. It first installs only UI and registry peers, checks strict declarations and validation, and bundles renderer/validation without native/server/files/heavy viewers. It then installs the files archive explicitly and drives native json-render with a borrowed SQLite document controller. DOM and server-rendering evidence does not qualify actual browser behavior or complete A25-A32.


## Optional layout document and Keep controls

Import `createExperienceDocumentController` and its concrete types from `@hachej/boring-ui-kit/experience/document`. Select `ExperienceDocument` from `@hachej/boring-ui-kit/experience/document-viewer` for React controls. These entries add the existing files publication contract to the fixed/derived grammar. Saved layouts require strict UTF-8 `application/json` with source `fixed`. A new target may start empty or with a validated fixed/derived draft.

`actions.propose(actions.selection(), descriptor)` records a detached offer against the exact resource base and buffer version. It does not change the displayed draft or publish. `actions.adopt(proposalId)` checks that base and current cell visibility, then selects the draft locally and returns its exact save selection. `flush(selection)` is the separate Keep operation. It creates or conditionally replaces the fixed JSON document and returns the provider receipt. A later offer never changes a kept layout without explicit adoption and another Keep.

The renderer exposes Use proposed layout, Dismiss proposed layout, Keep this layout, Refresh layout, Reconcile keep and Discard local layout. Conflicts preserve the local draft. Unknown saves reconcile the original operation without replay. Later adoptions and offers survive late acknowledgements. Explicit refresh retries a previously unavailable layout after access returns. Replacing the concrete controller resets the displayed layout immediately, even when both controllers have the same buffer version. The layout controller and all cell controllers remain borrowed on replacement and unmount.

Cell visibility validation is a current host preflight. A provider that promises atomic authorization of layout publication and its referenced resources must enforce both at its commit boundary. The renderer does not create that cross-resource guarantee. Live model quality, actual browser focus preservation and full A28-A29 remain unqualified. The bounded region/Pin implementation is described below.

Run `node fixtures/experience-keep.mjs` after building for a fictional offer, adoption, conditional creation and receipt lookup. `npm run test:experience-consumer` additionally checks the concrete Keep declarations, real SQLite/controller and React controls, and the resource-enabled browser bundle from isolated installed archives. These are DOM and artifact checks, not a browser journey.


## Optional metadata-only composition

`composeExperience` from `@hachej/boring-ui-kit/experience/compose` calls the pinned native `experimental_composeSpec`. It accepts json-render's `Experimental_CompositionEvaluator` directly. The headless entry needs no React runtime, files, agent or model SDK. The evaluator belongs to the host; it must authorize the current scope, processing route and budget before every provider attempt. The library checks current candidate visibility and cancellation before each delegation. That preflight does not supply atomic provider admission.

Supply `definition` with a static `name`, optional `title`, an `intents` map and kind registrations. Each kind registration has `kind`, a content-free static `description` and a `metadata` map of permitted string values. Each candidate supplies a registered `ref`, matching enumerated `metadata`, optional `root` and optional private `resource` grouping key. References resolve through the existing `cells`/`canView` access contract. Candidate props, bindings, state, action parameters, arbitrary descriptions and identifiers are ignored. The adapter creates opaque candidate, marker and resource IDs; it rebinds actual references only after composition. It never forwards caller context, instructions, initial state or raw request text. The `intent` must select a registered static string.

Static descriptions, intent strings and metadata enumerations are trusted host configuration. Their types and length limits cannot establish semantic privacy. The host must keep record content out of those registrations and authorize even enumerated metadata before external processing. Real cell references remain local and appear in validated descriptors; hosts must choose content-free references. The composer adds no operation registry, scheduler or provider engine.

Supply explicit `limits` with `maxElements` from 1 through 200, `maxDepth` from 1 through 24 and `maxEvaluations` from 1 through 32. There are at most 128 candidates and registered kinds, 16 metadata fields per kind/candidate, 32 values per field and 32 static intents. Descriptions are at most 500 characters, metadata values 80 and intents 1200. Accepted-input bounds do not bound peak allocation while parsing arbitrary trusted local objects or inside a provider.

Iteration captures definitions, candidates, cells and fallback before yielding the first snapshot. It returns frozen `default`, `partial` and `final` snapshots with a composition ID and increasing sequence. Every partial/final is rebuilt without native state and validated against current visibility before exposure. A `default` snapshot carries the current authorized fallback or null, plus a fixed reason of `pending`, `unavailable`, `cancelled` or `limit`. Raw evaluator errors and answer extras never become public diagnostics. Partials are provisional previews; they do not replace the selected layout.

The required `signal` belongs to the host. Abort it when the host closes composition. Upstream cancellation releases a pending composition even when an evaluator does not cooperate; it does not prove provider termination. Calling the iterator's `return()` alone cannot interrupt its pending `next()`. On a final result, pass the descriptor to the existing document controller's `propose` with the selection captured before composition. A stale base refuses. Explicit adoption and Keep remain separate human actions.

Run `node fixtures/generated-experience.mjs` after building for deterministic native composition followed by a real conditional SQLite Keep. The isolated experience consumer checks native evaluator declarations, metadata/cancellation behavior, rendered proposal controls and browser bundles from installed archives. Tests also exercise upstream `experimental_createEvaluator` with fictional fetch responses and host budget denial before each request. Those tests establish transport composition without a live Gateway/local model call, model-quality claim, actual browser journey or complete A27/A31 qualification. Full reference application recipes remain required. Region composition and Pin use the bounded API below.


## Generated regions and conditional Pin

Import `composeExperienceRegion` from `@hachej/boring-ui-kit/experience/regions`. It takes the existing composition inputs plus `descriptor`, `region` and an explicit `trigger` of `open`, `phase` or `request`. It returns the same snapshot union with full merged descriptors. It captures inputs before the first yield, retains the authorized default on refusal, and uses the native composer. Host policy still owns scope, budget, processing admission and cancellation.

A `boring/generated` node has a unique `region`, a `candidates` allowlist of refs or registered cell kinds, and saved default `children`. Optional `kinds` restricts both structural and cell kinds. New kinds must already be declared in the fixed descriptor. `maxElements` defaults to 64 and counts descendants, with a maximum of 200. `minWidth` is an integer CSS-pixel minimum from 0 to 4096, default 0. `regenerate` defaults to `['request']`. An optional `prompt` must match the selected registered intent key or its exact static text. Loaded free text is never forwarded as guidance.

Nested regions intersect permissions and budgets. Composition subtracts cell uses outside the target region, preserves fixed nodes and ancestors, and allocates fresh descendant IDs. Every partial and final result passes full descriptor validation. The live default remains selected until explicit acceptance. There is no timer or automatic composition on mount.

Call `controller.actions.beginRegion(selection, region, trigger)` before host composition. An applied result contains a frozen request. Pass that request and a final descriptor to `actions.proposeRegion`. A newer request for the same region invalidates older results, even at the same buffer version. `actions.adopt` selects the offered region locally. Region adoption preserves the original JSON spelling and whitespace outside replaced element members and the target's children value. Duplicate keys in edited objects are refused.

`state.pin` exposes an exact selection only when the draft began clean and contains changes to that region alone. `actions.pin(selection)` uses the existing conditional writer, receipt and reconciliation. It refuses unrelated dirty layout changes; use explicit whole-layout Keep for those. A late receipt retains later local changes. Pin never grants permission to referenced resources.

`ExperienceDocument` accepts `onRegenerate(request)` for its **Regenerate** controls. The host owns the evaluator and its abort signal. **Use proposed region**, **Dismiss proposed region** and **Pin this region** separate acceptance and publication. Fixed sibling renderer identities remain stable across region edits. Cell and grid minima inherit the strongest enclosing region minimum; narrow regions can scroll. Borrowed resource controllers survive unmount.

Run `node fixtures/generated-region.mjs` after building for a fictional native composition, offer, adoption and SQLite Pin receipt. Public tests and `npm run test:experience-consumer` exercise strict tarball declarations, real native composition, exact source, request races, DOM identity/selection and unknown-save reconciliation. DOM results do not qualify browser focus, geometry, live model quality or atomic cross-resource authorization.

## Consumer-defined text viewers

`@hachej/boring-ui-kit/text-buffer` exports the existing `createTextBuffer` and its concrete types for trusted consumer controllers. The root UI entry stays independent of resource providers. The buffer owns the draft, revision, exact flush selection and uncertain-save reconciliation; a custom controller can derive an immutable domain projection from its snapshot.

Validate initial and remote content through `readText`, and validate edits before calling `edit`. `observe` is intended for trusted external-store synchronization and bypasses read-only edit checks. `sync` and `replaceText` are synchronous hooks. Refresh checks the buffer again after `replaceText`, so a callback edit or disposal cannot be overwritten by the pending refresh.

The [task-list recipe](../../registry/README.md#task-list-viewer) implements a concrete consumer feature, domain operations and renderer. Its native tools share the domain transform and conditional publication provider. They edit saved resources; a mounted human draft keeps its own exact revision and conflict handling.

## Opt-in document draft recovery

Markdown, HTML, canvas and experience controllers accept `drafts: TextDraftOptions`.
Import that type and `TextDraftStore` from `@hachej/boring-ui-kit/text-buffer`. The host supplies
the store, stable `providerInstanceId`, session `signal` and `expiresAt`, and draft
`retentionMs`. Defaults bound each record to 8 MiB and each listing to 20 records.
The store must implement the [session and version contract](../../docs/architecture/WEBSITE-INTEGRATION.md#change-review-and-draft-recovery).
Omitting `drafts` leaves persistence disabled.

Edits request a checkpoint. Await `actions.checkpointDraft()` when you need its
storage result. `state.recovery` distinguishes pending, stored and failed
checkpoints. `actions.checkDrafts()` reads the current document and returns scoped
choices. Pass a choice's `selection` to `actions.restoreDraft` or
`actions.discardDraft`. Both recheck the resource revision, viewer selection and
stored record. Restore refuses newer local edits or an unsettled save.

Restore changes local content. Normal `flush(actions.selection())` still owns
publication and receipt validation. A matching acknowledgement removes only its
checkpoint, preserving newer typing and other writers. Store failures remain
visible without changing publication results. A restored source record can remain
available if you edit it before saving. Draft recovery does not persist or replay
an interrupted publication request.

Canvas recovery validates native document records and schema. It excludes camera
and session records. Experience recovery validates fixed descriptor text and clears
old proposals and Pin authority. Supply `validateDocument` to enforce additional
host rules when reading or restoring an experience. Custom text controllers can
supply `drafts.validateText` for their own format.

Logout must revoke the host storage session transactionally and purge its payloads,
then abort its signal. Aborting a signal alone cannot fence another tab's delayed
write. Ordinary viewer disposal leaves the borrowed store available to other
viewers. Encryption, retention enforcement and authenticated storage policy remain
host responsibilities. This option does not implement durable chat drafts.

## File tree and filename mentions

Bind the authenticated [revision provider](../files/README.md#frontend-revision-provider)
to the tree:

```tsx
// Installed file-tree recipe, with the consumer's real shadcn Base UI controls.
import { FileTree } from '@/components/file-tree/file-tree';

<FileTree
  revisionProvider={revisionProvider}
  selectedPath={selectedPath}
  onOpen={path => openFile(path)}
/>
```

The renderer adapts the official shadcn `sidebar-11` tree. Its shipped CSS works
without a SidebarProvider or scanning package sources with Tailwind. Attribution
and the pinned upstream revision are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The recipe supplies the consumer's actual shadcn Button and dropdown-menu, plus
shared version-history rows. Direct callers of `@hachej/boring-ui-kit/file-tree-view`
pass a required `components` binding with `Button`, `Actions` and `Versions`;
`FileTreeComponents`, `FileTreeButtonProps`, `FileTreeActionsProps` and
`FileTreeVersionsProps` describe it. There is no package-owned control fallback.
The installed wrappers supply this binding automatically. Library history and viewer
menus share relative time, provenance and Current presentation. Selecting a retained
version still reads an exact, read-only preview without retargeting an editor.

The default `list` variant has a Library header, visible-item count, inset search,
48px rows with kind and size, and a file actions menu. The count describes loaded,
visible items, including folders; it is not a workspace total. A folder shows its
child count only after its provider listing is complete; unloaded, loading, failed
or paginated listings show no count. The menu offers
Open, Version history and Download through the same provider. When the client has
`rename`, files also offer Rename (inline in the row, F2) and Move to… (plus dragging a
file onto a folder or the root); when it has `delete`, Delete (Delete key, after a
confirmation dialog). `capabilities={{ effective }}`, when the host passes it, only
narrows these to the listed `rename`/`delete`. Each change is a conditional write with the
revision read when the action started (`controller.prepare`); a refusal stays on the
row until dismissed and the affected folders are read again. A committed change calls
`onRenamed(from, to)` or `onDeleted(path)`, so a host's viewer follows the file or closes
(`AgentWorkspace` and `Documents` do). Folders are destinations
only. No edit date or
author is invented or fetched per row. `variant="plain"` keeps the compact tree.
`title` overrides the list heading; `onClose` adds a host-owned close button.

The tree supports folder expansion, keyboard navigation, filename search,
pagination, picker or drop uploads and read-only revision previews. Uploads go to `uploads/`
by default (`uploadDirectory` overrides it). Duplicate names refuse publication.
Uploads show progress inline on their row. Successful uploads leave no visible
status log; a visually hidden polite live region announces results. Failures keep
an inline error and **Retry**. A refused upload retries its captured bytes with the
same revision condition; an unconfirmed upload only checks its original operation
and never republishes. Keep the local file until the result is known. Upload state is in memory and is not a durable cross-reload upload queue.

Both components take `locale` (`en` by default, or `fr`; the words are exported as
`defaultFileTreeLabels` and `frenchFileTreeLabels`) and `labels` to override any word,
including the accessible names, or to add another language, `upload={false}` and
`history={false}` to hide upload controls or the version-history menu item, and `refreshKey`: when its value changes the open folders and the current
search reload, for example after an agent saves a file. A search result shows its
name with its folder in the metadata line in `list`, or on the same line in `plain`. `AgentWorkspace` passes the same options to its
Library through `fileTree`, with its own `locale`.

For custom layouts, import `createFileTreeController` from
`@hachej/boring-ui-kit/file-tree`; `FileTreeView` borrows that concrete controller.
Dispose an owned controller when finished. Disposing it cancels its observations
without disposing the shared provider. A custom `onOpen` must protect any dirty
editor before navigating. Both components can mount in a detached window or another
layout. Pass that window an authenticated provider binding and route `onOpen` to
the intended viewer; the tree does not own a workspace layout or window transport.

The installed `pi-app` recipe accepts the same `revisionProvider` prop on
`AgentWorkspace`. Its left-pane Library menu opens the tree in the center/chat area.
Selecting a file opens the right artifact viewer. Chat stays mounted while Library
is visible, preserving its draft. It also supplies filename results for `@`, attachment
publication and retained history without separate file callbacks. Its built-in
text editor navigation asks before discarding unsaved content. The legacy
`resources` binding remains available for existing hosts; use one binding at a
time. History previews never replace the editable document.

## Staged answers in native chat

The [fictional triage-note recipe](../../examples/staged-chat/README.md) composes three sequential native Pi tasks with validation and inline stage entries, two independent chat controllers, error restoration, historical offers, host-owned unread indicators and a 24-row initial display window. It owns the exact API semantics and limitations for `hideLine`, `historicalMessageActions`, `unread`, `replyError`, `displayLimit`, stage-card `status` and `createNativeChatController({ restoreOnError: true })`. These are optional presentation/draft seams, not a kit workflow, retention service or additional transcript store.
