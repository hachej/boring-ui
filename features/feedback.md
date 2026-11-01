# Feedback

`feedback` lets a person comment on the live app: comment mode with pins on elements, voice notes, reports the agent can list.

## Sub-features

- `feedback-comment-mode` on/off switch, banner, pins named in plain words. `registry/feedback/point-mode.tsx`, `point-button.tsx`.
- `feedback-voice` hold to record a note. `registry/feedback/voice-input.tsx`.
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
- **Preview.** `feedback-preview`: `npm run feedback:journey:preview`.
- **Store.** `feedback-store`: `npm run test` covers `packages/feedback`.
- **Proof.** Screenshot of the pin and the saved report read back.

## Gotchas

- Comment mode needs `pi-chat`'s `use-hold-to-record`, installed with `feedback`.
- Back ends comment mode.
