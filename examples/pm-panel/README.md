# Fictional PM panel fixture

The public AppShell, regular composer, native remote-chat controller/transport and scripted model. Voice uses Chromium's fake microphone and a fictional timestamped transcription callback; it does not access the Factory PM door or production.

After `npm ci && npm run build`:

```sh
node examples/pm-panel/server.mjs
CHROMIUM=/path/to/chrome-headless-shell node examples/pm-panel/journey.mjs
CHROMIUM=/path/to/chrome-headless-shell node examples/pm-panel/journey-faults.mjs
```

Use the task's `flock`/`systemd-run` memory scope for heavy runs. The happy-path journey exercises phone 390×844 and desktop, writes `.agent-handoff/pm-panel/screenshots/`, and checks in-flow rectangles and real hit tests. `PM_BEFORE=1` loads pre-feature AppShell sources to demonstrate the new public-path test failing. `PM_CASE=ime` (or another case name in `journey-faults.mjs`) selects one fault case.

Fault cases: long inline editor, desktop IME/code 229, deferred transcription, cumulative recording timelines, a lost admission acknowledgement followed by lookup, and replacement controllers with identical logical IDs. The fixture's second remote controller exists only to exercise that final ownership race; domain input must survive replacement.

The task source and D-417 renderer callbacks are fictional test seams, not a duplicate task board or request card. Current fixture data/screenshots predate the detailed owner specs in `/home/ubuntu/projects/_work/pm-spec`; they are behavioral evidence, not pixel-equivalence evidence. No requested side-by-side comparisons have been produced yet.
