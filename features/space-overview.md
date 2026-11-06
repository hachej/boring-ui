# Space overview blocks

Generic blocks for the "what is going on across my apps" surfaces: a card per app or space, and the chips that say what an app is wired to. They take props and call back; the host fetches. Patterns inspired by the Bench (patterns only), built on the style v1 tokens.

## Sub-features

- `space-card` `SpaceCard` shows one app or space: its name, the working and waiting counts (semibold sans, tabular), and the "Last ship" line (sans, muted; the label is overridable) when known. Both counts at 0 read "Quiet". `activity: 'unknown'` reads "Status unreadable" and hides the last ship: an unreadable app is never shown as Quiet. It is a button when `onOpen` is given. Both forms sit on `--card` (white on the canvas); the initial chip is `--secondary`; the button form hovers to `--accent` (the chip flips to `--card`) and keeps the Button focus ring. `test/ui/surface-cards.test.mjs` renders both and asserts the surfaces (light and dark). `registry/space-card/space-card.tsx`.
- `wiring-chips` `WiringChips` lists what an app is wired to (domain, repository, channels, connections), one chip each with a state dot: `ok`, `warn` (needs attention, such as a sign-in) or `unknown` (could not be read). `state` is required, and a missing one reads as `unknown`, never ok. The dot is colour only for sighted people (assistive tech also hears the state), so put the state in the chip text when it matters: "Calendar needs sign-in". `registry/wiring-chips/wiring-chips.tsx`.

## How to get to it (user POV)

- A home view shows one space card per app; tapping a card opens the app. An app page shows its chips under the title.

## Driving it with the render test

Preconditions: `node_modules` installed, so in CI on this VM.

- **Cards.** `space-card`: `node --test test/ui/space-blocks.test.mjs` renders busy, quiet and unreadable cards, the optional last ship and the button/static split.
- **Chips.** `wiring-chips`: the same test renders the three states, the spoken state for non-ok chips and French labels.

## Gotchas

- The blocks send and fetch nothing; the host passes counts already computed and times already formatted.
- Pass `'unknown'` whenever the status could not be read. Do not pass zeros: that reads as Quiet.
- The waiting count is the same number the surface's needs-you count adds up; do not compute it twice.
