# Feedback

`feedback` lets a person comment on the live app: comment mode with pins on elements, voice notes, reports the agent can list.

## Sub-features

- `feedback-comment-mode` on/off switch, banner, pins named in plain words. `registry/feedback/point-mode.tsx`, `point-button.tsx`.
- `feedback-voice` hold to record a note. `registry/feedback/voice-input.tsx`.
- `feedback-surface` a note pinned to a point of one surface (an image, a video frame): `surface: { element, onPoint, pins }` on `createFeedbackSession`, the point on the note, `pins: "host"` for host-drawn marks. `packages/feedback/src/ui/session.ts`, `registry/feedback/feedback-session.tsx` (`NoteBubble`).
- `feedback-surface-bubble` (D-1967) the bubble of a note pinned on a surface: stays inside the surface's box (`within`, default `surface`), flips left near the right edge and above the point near the bottom; a bottom sheet (`Drawer`) below the phone breakpoint; the `.boring-feedback-bubble` rule in `registry/feedback/feedback.css` is its popover surface, shipped in the item `css` and so in the bundle's `blocks.css`. `registry/feedback/feedback-session.tsx` (`bubblePlace`, `NoteBubble`).
- `feedback-reports` list, card and element lines the agent can show. `registry/feedback/feedback-list.tsx`, `feedback-card.tsx`.
- `feedback-preview` banner on a preview build. `registry/feedback-preview/preview-banner.tsx`.
- `feedback-store` capture and delivery package. `packages/feedback/src/`.

## How to get to it (user POV)

- Account menu « Améliorer l'app » in a shell with `improve`, or the comment banner in a preview.

## Driving it with the example journeys

Preconditions: `npm run build`, Chromium.

- **Composer.** `feedback-voice`: `npm run feedback:journey`.
- **Point.** `feedback-comment-mode`: `npm run feedback:journey:point`, switch on, click an element, a pin appears.
- **Picker and reports.** `feedback-reports`: `npm run feedback:journey:picker`, `feedback:journey:ticket`.
- **Surface.** `feedback-surface`: `node --test test/packages/feedback-surface.test.mjs` (needs `CHROMIUM`): in comment mode click an image at (0.25, 0.75), the note and `onPoint` carry that point; with `pins: "host"` no pinned box; Enter on the focused image drops one at (0.5, 0.5). Send, Done, then the sent report holds `[point 0.25,0.75]` and the save route accepts it; on touch a tap pins and a drag, a drag that comes back, a cancelled gesture or a second finger pins nothing; a `scaleX(-1)` image, a `scale: -1 1` image, a mirrored ancestor and a `rotate: 90deg` image report local fractions and `NoteBubble` opens beside the drawn point.
- **Surface bubble.** `feedback-surface-bubble`: `node --test test/packages/feedback-bubble.test.mjs` (needs `CHROMIUM`): in comment mode with `pins: "host"` click a 640x420 surface at 60% across, at 97% across and at 95% down: the bubble box is inside the surface box, flips left of the right-edge point and above the bottom point; at 390 with touch a tap opens a bottom sheet (`data-slot="drawer-popup"`) resting on the bottom edge; with only the merged registry `css` loaded (the bundle's `blocks.css`) its background is the popover token with border, shadow and radius. Shots (1280 and 390, light and dark, edge flips) go to `FEEDBACK_BUBBLE_EVIDENCE`; CI uploads them as `note-bubble-shots`.
- **Preview.** `feedback-preview`: `npm run feedback:journey:preview`.
- **Store.** `feedback-store`: `npm run test` covers `packages/feedback`.
- **Proof.** Screenshot of the pin and the saved report read back.

## Gotchas

- Comment mode needs `pi-chat`'s `use-hold-to-record`, installed with `feedback`.
- Back ends comment mode.
