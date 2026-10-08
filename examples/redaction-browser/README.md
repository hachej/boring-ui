# Run the fictional consultation workspace

```bash
npm run build
npm run redaction:browser
```

Open `http://127.0.0.1:3001`. The server keeps two fictional consultations under `.cache/redaction-browser-demo`. It uses SQLite, native Pi tasks, a scripted model and fictional transcription. It requires no model credentials or microphone.

1. Edit the consultation notes, then select **Generate A/B/C from selected notes**. Generation requires an acknowledgement for the exact selected buffer. Later typing remains a local draft.
2. Select **Refresh proposal A** to inspect its proposed items. Save a correction and choose proposed or corrected text for each item.
3. Select **Adopt selected A**, then **Check adoption A**. Adoption conditionally saves the structured record and letter together. A local letter draft or changed reviewed revision blocks adoption.
4. Select **Observe latest** after a reload to inspect existing work. Observation does not start tasks. If admission is uncertain, retry its original request through the displayed recovery control.
5. Place the cursor in source-mode notes and select **Insert fictional dictation**. A delayed transcript stays bound to that consultation, editor mount, buffer and cursor. If the target changes, the transcript remains visible for review.

6. Select **Prepare selected notes**, then **Observe preparation**. Preparation has its own native source read, validation and conditional JSON delivery. Its six sections remain above the notes. It never inserts preparation text into the notes.
7. Select **Arrange preparation**, then **Use preparation arrangement** to accept an offer locally. **Pin preparation** saves that exact layout through conditional publication. A new preparation can offer a layout without adopting it. Width and disclosure controls stay local.

Each block has independent native work. Switching consultations preserves local drafts. Closing the browser leaves host-owned tasks running.

## Verification commands

```bash
node --test --experimental-test-isolation=none test/compatibility/redaction-browser-runtime.test.mjs
npm run test:redaction-browser-consumer
npm run redaction:journey
npm run redaction:preparation:journey
```

The consumer command installs package tarballs in a separate app and runs the native, crash and DOM fixtures there. The journey command drives actual Chromium controls with fictional services. Raw browser evidence goes to `.cache/evidence/redaction-browser-journey/`.

The example's fixed bearer and origin check demonstrate a bounded transport, not production identity. Live transcription, model quality, clinical expert acceptance, live layout evaluator quality and migration of the clinical application remain unqualified. See the [redaction findings](../../docs/stress-tests/REDACTION.md) and [implementation checkpoint](../../docs/implementation/PARTIAL.md).

## Preparation policy and recovery

The CLI explicitly selects a deterministic fake layout evaluator. A host that does not inject an evaluator retains the default layout and returns unavailable. An external `jev` evaluator requires the host's separate processing permission. The evaluator receives registered card types and enumerated metadata only. It receives no clinical text, source references, dates or request identifiers.

An uncertain admission retains its original request for retry. Reload observes existing work without admitting it. A stale source or output refuses publication. Lost layout acknowledgements require **Reconcile preparation layout**. Revoking preparation access hides its content while independently authorized notes remain usable.

The preparation journey records evidence under `.cache/evidence/redaction-preparation-journey/`. Native tests include actual child-process kills after reservation, admission and publication. These fictional fixtures do not qualify clinical judgment or a live provider.
