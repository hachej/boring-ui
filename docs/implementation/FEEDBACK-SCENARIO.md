# Feedback scenario: step A in an outside application

A quick, repeatable check of **adoption step A, annotation only: Feedback,
notes, Copy report** (the composer UX of
[FEEDBACK.md, "UX"](../architecture/FEEDBACK.md#ux-one-entry-point-feedback)), in an application that consumes the packages the way an
outside application would. It validates the feature and the install path
before feedback is rolled into real applications. It is manual evidence, not
part of `npm test`. Feedback itself is specified in
[FEEDBACK.md](../architecture/FEEDBACK.md); Release 1 status is in
[FEEDBACK-WORK-PACKAGES.md](FEEDBACK-WORK-PACKAGES.md#release-1-sequence).

## Run it

```sh
npm ci --no-audit --no-fund
npm run feedback:scenario                 # Ledgerly, built outside the repository
npm run feedback:scenario -- --fresh      # reinstall instead of reusing the cached install
npm run feedback:scenario -- --build      # rebuild packages/*/dist first (otherwise built only when missing)
npm run feedback:scenario -- --url <page url> --config <app>/feedback.scenario.mjs   # a real app that already mounts feedback
npm run feedback:scenario -- --kit <dir>  # tarballs + registry item for installing into a real app (below)
```

Chromium is `CHROMIUM` or the Playwright build at
`~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`. npm
uses `npm_config_cache` or `~/.npm`, with `--prefer-offline`.

A fresh install takes about 20 s; a cached run about 25 s in total, of which
about 6 s are the browser steps. Evidence goes to
`.cache/evidence/feedback-scenario/`: one screenshot per step, `report.md` and
`report-duplicate.md` (the copied reports), and `summary.json` (rows, labels,
report fields, install timings and the app directory). Stdout ends with a
PASS/FAIL table; the exit code is 0 only when every row passes or is skipped.

## What it builds

[`scripts/feedback-scenario.mjs`](../../scripts/feedback-scenario.mjs) creates
**Ledgerly**, a fictional bookkeeping page, in
`$TMPDIR/boring-feedback-scenario/ledgerly-<key>/`, outside the repository.
The key hashes the packed tarballs, the registry item and `package-lock.json`,
so any change to what a consumer receives reinstalls.

1. **Install as a consumer.** `@hachej/boring-feedback`, `@hachej/boring-ui-kit` and
   `@hachej/boring-files` are packed fresh with `npm pack`. Every other dependency is
   locked to this repository's lock entries. This is the machinery of the
   other isolated consumers, shared through
   [`scripts/consumer-install.mjs`](../../scripts/consumer-install.mjs).
2. **Add the `feedback` registry item with the real pinned shadcn CLI**
   (`shadcn add feedback.json`). Its pins point at the integrity-checked
   archives. The CLI copies the six components into `src/components/feedback/`
   and merges the scoped CSS into `src/index.css`.
3. **Copy Ledgerly's own source** from
   [`examples/feedback-scenario/ledgerly/`](../../examples/feedback-scenario/ledgerly)
   on every run:
   - the page: header and nav, form and exports marked `data-feedback-visible`;
     an accounts table with fictional names, IBAN-like strings and amounts left
     masked; form values; two identical Export buttons; a `data-feedback-id`
     row;
   - the mount in `src/main.jsx`: the feedback session (`createFeedbackSession`)
     with `FeedbackBar`, `NoteBubble` and a minimal stand-in for a chat
     composer (its Feedback button, `composer-feedback`, and the
     `FeedbackChip` whose review offers Copy report), no store,
     no agent, plus an "Open a copied report" panel;
   - `build.mjs`, `serve.mjs` and `feedback.scenario.mjs`.
4. **Bundle with Ledgerly's `build.mjs`**: esbuild with
   `feedbackSourcePlugin({ mode: 'development' })`, under the consumer
   isolation hook. The run checks that:
   - every bundle input is inside the app;
   - the CLI-installed components and the installed `@hachej/boring-feedback` are
     used;
   - the source runtime was substituted;
   - no store, agent or server code is bundled.

## The config

The runner reads `feedback.scenario.mjs` (default: Ledgerly's;
`--config <path>` for another app). Its default export:

| Field | Meaning |
| --- | --- |
| `url` | A path on the app's origin, or a full URL. `--url` overrides it. Ledgerly's carries ids, a query and a fragment that must not leave the page |
| `point` | CSS selector of the element to point at and pin (exactly one match) |
| `masked` | Optional. An element in a data region: its picker label must say `masked` |
| `expect.label` | Optional. The exact overlay label while pointing |
| `expect.fallback` | The anchor's fallback: a string (exact) or a RegExp |
| `expect.source` | A prefix of the anchor's `data-source` (`src/ledger/SaveBar.jsx:`); the line may move |
| `expect.route` | The route template the report must carry |
| `sensitive` | Strings that must never appear, in any spelling, in anything captured |
| `duplicate` | Optional. A selector matching two or more identical elements without identity |

The page must mount the session with the registry components and their
default test ids (`composer-feedback`, `feedback-bar`, `feedback-bubble-input`,
`feedback-done`, `feedback-chip-open`, `feedback-copy`, `feedback-status`, …),
with `copy` on the `FeedbackChip` (a page whose chip only sends with a chat
message cannot run step 4). For step 5 it also needs Ledgerly's "Open a copied
report" panel (`feedback-open-copied`, `feedback-paste`,
`feedback-paste-open`, then the registry's `FeedbackReport`). Without that
panel, step 5 is skipped with a note.

## What each step proves

| Step | Proves |
| --- | --- |
| install and bundle | The packed tarballs, the registry item and the shadcn CLI produce a working install outside the monorepo. Annotation only installs no agent or Pi packages and bundles no store, agent or server code |
| 1 open | The page loads with the overlay mounted and `data-source` stamps present, and has no Point button |
| 2 Feedback, point and refine | Feedback enters feedback mode. Real pointer input gives a readable label (`SaveBar · button «Save entry»`), not `masked`. ↑ selects the parent and ↓ returns. An element in the data region is labelled `masked` |
| 3 pin without activating | Clicking the target drops pin ① and its note bubble. Click and submit listeners on the target and its form never fire, and the page's own text is unchanged |
| 4 note, Done and Copy report | Enter keeps the note, Done puts the chip in the stand-in composer, and its review's Copy puts the `feedback@1` report on the clipboard: the Clipboard API call is recorded, and on a secure origin the system clipboard is read back. The text equals what the review shows. Route is the template, fallback and `data-source` match, the note (`1. [anchor 1] …`) follows the untrusted preface. The report is kept as `report.md` |
| 5 duplicate | A pin on one of two identical Export buttons, copied from a second session and then pasted into "Open a copied report", makes Show offer numbered candidates with numbers only on the overlay. Choosing 1 boxes the first. Nothing is pressed |
| 6 privacy | No `sensitive` value appears in any captured output. Spellings checked: raw, HTML entities (named and numeric), percent- and form-encoded, JSON-escaped and with spaces removed. Captured outputs: reports, clipboard writes, picker labels and bar hints, bubble labels, the chip and review, candidates, the report panel, feedback's visible text, the table rows. Leaks are reported by index and spelling, never by value |
| 7 no page errors | No exception or console error during the run |

## Installing into a real application (step A)

The `@boring` packages are private and unpublished, so a real application
installs tarballs. The pinned item cannot be added as is.

```sh
# in this repository
npm run build
npm run feedback:scenario -- --kit /path/to/app/vendor/boring-feedback
# in the application (a shadcn components.json is present)
npx shadcn@4.21.1 add /path/to/app/vendor/boring-feedback/feedback.json
```

The CLI installs the three tarballs plus `react`/`react-dom`, copies the
components to `components/feedback/`, and merges the
`[data-boring="feedback"]` CSS into the app stylesheet. Then mount, outside
the application root:

```jsx
import { useEffect, useState } from 'react';
import { createPrivacyPolicy } from '@hachej/boring-feedback/page';
import { createFeedbackSession } from '@hachej/boring-feedback/ui';
import { FeedbackBar, NoteBubble, useComposerFeedback } from '@/components/feedback/feedback-session';
import { pickerOverlayStyles } from '@/components/feedback/picker-overlay';

const policy = createPrivacyPolicy({ routeOf: ({ pathname }) => myRouteTemplate(pathname) }); // e.g. '/books/:bookId'
const appRoot = () => document.getElementById('app');

export function Feedback({ children }) {
  const [session, setSession] = useState(null);
  useEffect(() => {
    const created = createFeedbackSession({ app: 'my-app', policy, root: appRoot(), styles: pickerOverlayStyles });
    setSession(created);
    return () => created.dispose();
  }, []);
  const feedback = useComposerFeedback(session ?? undefined); // pass to <AmbientChat feedback={feedback} /> or <PiChat feedback={feedback} />
  return <div data-feedback-ignore="">
    {session && <FeedbackBar session={session} />}
    {session && <NoteBubble session={session} />}
    {children(feedback)}
  </div>;
}
```

Without a chat, render the Feedback button and `FeedbackChip` with `copy`
yourself, as Ledgerly's `src/main.jsx` does.

- **Mark visible regions.** Put `data-feedback-visible` on regions that hold
  no personal data (header, nav, forms' labels and buttons). Everything else
  is masked.
- **Source locations (development only).** Use esbuild with
  `feedbackSourcePlugin({ root, mode: 'development' })`, `jsx: 'automatic'`,
  `jsxDev: true` and `absWorkingDir: root`. See Ledgerly's `build.mjs`.
- **Run the scenario against the app.** Write the app's own
  `feedback.scenario.mjs` and run
  `npm run feedback:scenario -- --url <page> --config <file>`.

## Two-minute manual checklist

1. Run `npm run feedback:scenario` once. Then
   `cd "$(node -p "require('./.cache/evidence/feedback-scenario/summary.json').install.app")" && node serve.mjs`
   and open the printed URL.
2. **Feedback.** Click Feedback and hover "Save entry": the label reads
   `SaveBar · button «Save entry»`. Press ↑, then ↓. Hover a table row: it
   reads `… · masked`.
3. **Pin.** Click "Save entry". Pin ① and a note bubble appear and "Entry
   saved" does not appear.
4. **Copy.** Type a note, press Enter, then Done; open the chip and press Copy
   report. Paste it somewhere visible: no name, IBAN, amount or id from the
   URL, and the route is `/books/:bookId/accounts/:accountId`.
5. **Agent.** In the same app directory, start Claude Code and paste the
   report with "Please address this feedback." Check that the agent:
   - opens `src/ledger/SaveBar.jsx`, the `data-source` line;
   - treats the quoted screen content as untrusted;
   - does not ask for the masked data.
6. **Duplicate.** Pin an Export button in a new feedback session, copy, then "Open a copied report",
   paste, Open, Show. Two numbered candidates appear and nothing is revealed
   until you choose.

## Limits

- **One browser, one viewport.** Desktop Chromium, secure origin `127.0.0.1`.
  The composer, ⌥ pass-through and Send are covered by
  `npm run feedback:journey`; insecure-origin Copy and touch picking of the
  classic UI by `npm run feedback:journey:picker`, not here.
- **Annotation only.** Save, the store and the agent capability are not
  exercised. The agent check is the manual step 5; FEEDBACK-2 readability
  stays unjudged.
- **npm and esbuild only.** Source locations need esbuild: the package has no
  Vite/Babel variant. Other installers are not run: pnpm and Yarn are only
  covered by the manifest test
  (`test/packages/feedback-manifest.test.mjs`).
- **Tarball install.** Real applications install tarballs (`--kit`) until the
  packages are published.
