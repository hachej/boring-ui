# PM composer and panel — work in progress

`PmComposer` is the one host-agnostic composer export, built over the regular kit `Composer` and #1882 recording bar. It is available from `components/pm-panel/pm-panel` or `components/pm-panel/pm-composer` after installing the `pm-panel` registry item. `PiChat` and `AmbientChat` accept `renderComposer={props => <PmComposer composer={props} … />}` and optional `sendContext`; no host controller or Pi lifecycle is replaced.

Current AppShell integration:

```tsx
<AppShell {...app} improve={pm} />
// pm: ImproveSpec; the host already owns its remote NativeChatController,
// optional pointVoice transcription, taskMentions and task-board bindings.
```

The newer requested `improve: { agent: 'pm' }` resolver is **not implemented**. The latest specifications in `/home/ubuntu/projects/_work/pm-spec` supersede the original brief. This candidate has runtime behavior and regression evidence, not visual acceptance. Do not release or claim mockup equivalence from its screenshots.

## Exports

- `PmComposer`, `PmComposerProps`: shared compose/recording/strip presentation. Supplies no router or backend.
- `usePmPanel`, `PmPanelState`: local selections, native draft context and shared capture orchestration. Mount once per controller instance; remount this state owner on replacement. AppShell does that without remounting the app page.
- `PmPanelProvider`, `ImproveLayout`, `ImproveSpec`: explicit borrowed-controller layout composition.
- `useTaskMentions`, `TaskMentionSource`, `TaskMention`: host-authorized task search/title/present ports.
- `PmVoice`, `PmTranscript`: host transcription and optional live speech. Timings are seconds; picks sample the existing capture clock and are sent as milliseconds.
- `StudioTaskBoardSeam`: `renderRequest()` and `renderBoard({ filter: 'mine', variant, limit? })`. D-417 / PR #1900 owns the actual card and board. This item builds no alternative.

## Data and lifecycle

The public feedback picker (`tap: 'pick'`) owns event interception; labels and captures pass its privacy policy. Images are native message attachments. `pm.points@1` text metadata references each screenshot by zero-based native image index and carries selections, screen, anchor, speech segments and timing. It is untrusted observation, never an approval or grant. Image rendering deliberately excludes media URLs, existing canvas pixels and form values.

The host must provide the kit's authenticated remote-chat watch/history/submit/submission-lookup contract, stable shared PM conversation identity and normal revocation/ownership policy. Factory #854 currently blocks that door's watch. Transcription is a separate host capability, not a call to the PM door. Task search/present and durable request decisions also stay with the host.

Closing releases local microphone/selection resources, not admitted work. Unknown admission shows a read-only draft preview and reconciles the original native request. Cleanup is batch-scoped and instance-fenced. Multiple dictations retain a cumulative timing timeline. The inline editor is bounded, supports atomic removal and preserves the stock IME guard.

## Evidence

After `npm ci && npm run build`, set `CHROMIUM` to a Chromium binary:

```sh
node --test test/contracts/pm-point-state.test.mjs test/contracts/pm-composer.test.mjs
node examples/pm-panel/journey.mjs
node examples/pm-panel/journey-faults.mjs
```

The example server is `node examples/pm-panel/server.mjs`. The browser journey writes `.agent-handoff/pm-panel/screenshots/`. Use the resource-scoped command in the task brief for heavy runs. The six fault regressions were demonstrated failing before correction. The original public AppShell journey also fails against pre-feature source (`PM_BEFORE=1`).

Remaining spec work includes exact touch/desktop/EN presets and copy, 60px strip, 24px top-right pins, renumbering/tap-to-remove, preceding-word alignment, null idle timestamps, draft metadata, C6 header, C7 overlay/header/card, task picker keyboard/presentation, one-line PM resolution, and the requested side-by-side board comparisons.
