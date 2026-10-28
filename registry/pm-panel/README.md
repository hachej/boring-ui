# PM composer and panel

« Améliorer l’app » (specs `/home/ubuntu/projects/_work/pm-spec`, boards C1–C7 and D1, D7, D7b, D8, D9). Install the `pm-panel` registry item; the app's theme defines the `--pm-*` tokens (the registry theme has defaults).

```tsx
<AppShell {...app} improve={pm} />
// pm: ImproveSpec — the host's remote NativeChatController, appName, optional pointVoice transcription, taskMentions and the task-board seam.
<PmChat spec={pm} page={appFrameElement} screen="My day" preset="desktop" /> // Studio's conversation column
```

The one-line `improve: { agent: 'pm' }` resolver is **not implemented**: the host owns credentials and passes the controller.

## Exports

- `PmComposer`, `PmComposerProps`, `PmPreset`, `PointerIcon`: the one composer (`touch` | `desktop`), compose and strip variants. No router or backend.
- `PmChat`: thread plus composer for a column; the strip replaces the composer while pointing.
- `usePmPanel`, `PmPanelState`: picks, pins, recording, merge, meta line, Esc and send context. One per controller instance.
- `PmPanelProvider`, `ImproveLayout`, `ImproveSpec`: AppShell's in-flow layout (sheet, strip, full panel).
- `pmEntries`, `pointMessage`, `PointChipView`: the thread's renderers (sent chips, PM reply, request card).
- `pmTextFr`, `pmTextEn`, `pmTextFor`, `PmText`: spec strings.
- `useTaskMentions`, `TaskMentionSource`, `TaskMention`: the @ task picker over host-authorized data.
- `PmVoice`, `PmTranscript`: host transcription with word timings (seconds).
- `StudioTaskBoardSeam`: `renderRequest({ entry, edit })` and `renderBoard({ filter: 'mine', variant, limit? })`. D-417 / PR #1900 owns the card and board.

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

Board comparisons: `node examples/pm-panel/journey-boards.mjs` and `journey-studio.mjs` write `.agent-handoff/pm-panel/compare/<board>.png`. Open: the one-line resolver and PR #1900's compact card.
