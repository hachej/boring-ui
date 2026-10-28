# In-app PM panel (implementation in progress)

A shared composer and local pointing state over the existing kit chat, picker and voice lifecycle. The latest owner specifications under `/home/ubuntu/projects/_work/pm-spec` supersede the handoff brief; visual equivalence and the one-line agent resolver are not implemented or qualified by this increment.

## Sub-features

- `pm-composer` exports `PmComposer` for a sheet, conversation column or ambient host. `registry/pm-panel/pm-composer.tsx`.
- `pm-point-state` keeps selection/navigate/sheet/full state, screen associations and recording-time markers. `registry/pm-panel/point-state.ts` and `use-pm-panel.ts`.
- `pm-inline-review` merges timed speech with editable atomic selection chips, then renders timestamped sent chips. `registry/pm-panel/inline-point-input.tsx` and `point-message.tsx`.
- `pm-task-mentions` injects the authorized task source and present callback, with mine/all filters and native `@task:path` tokens. `registry/pm-panel/task-mentions.tsx`.
- `pm-inflow-layout` shrinks the page around the sheet/strip; the current full view also remains in flow (latest C7 overlay design remains work). `registry/pm-panel/pm-panel.tsx` and `registry/app-shell/app-shell.tsx`.
- `pm-send-context` uses PiChat/AmbientChat `sendContext` and `renderComposer`, and Composer's `renderInput`/visual placeholder seams without replacing native admission. `registry/pi-chat/pi-chat.tsx`, `registry/pi-chat/session.tsx`, `registry/pi-chat/composer.tsx`, `registry/pi-ambient/ambient.tsx`.

## How to get to it (user POV)

Open the account menu, choose Improve the app, then type or choose the arrow to point. The strip's microphone records; the hand lets the app navigate. Done returns an editable description. Send opens the thread. Task mentions use the host's data. Request cards and boards remain the unmerged D-417 component owner's responsibility.

## Driving it with the example journeys

- `pm-composer`: `node --test test/contracts/pm-composer.test.mjs` renders the same export in three host wrappers.
- `pm-point-state`: `node --test test/contracts/pm-point-state.test.mjs`; the browser journey also checks the public picker and tab behavior.
- `pm-inline-review`: `node examples/pm-panel/journey.mjs` with `CHROMIUM` set; screenshots C2–C7 are fictional examples, not spec-equivalence proof.
- `pm-task-mentions`: the journey opens @, switches mine/all and invokes the host present callback.
- `pm-inflow-layout`: that journey asserts rectangles and actual hit tests at 390×844 and desktop.
- `pm-send-context`: `node examples/pm-panel/journey-faults.mjs` exercises long input, IME, deferred transcription, two recordings, lost admission replies/reconciliation and controller replacement.

## Gotchas

The Factory PM door's watch is blocked by #854; these fixtures use the real kit remote transport with fictional models, microphone and transcription. Capture rasterizes the policy-filtered DOM, excluding external media and form values; it is not an unrestricted screenshot API. Word/segment alignment currently uses nearest proven boundaries, not the latest spec's preceding-word rule. Current numbering, pins, 56px strip, copy/presets, task picker and full-panel geometry still differ from the latest specs. `StudioTaskBoardSeam` is not an implementation of the task board or durable confirmation. No consumer app or Factory code is changed.
