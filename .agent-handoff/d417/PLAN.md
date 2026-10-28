# D-417 — task presentation

Contract: the owner's [handoff](https://github.com/hachej/boring-factory) requests one task board/detail/compact-list component and task references through `present`, without a second task backend or PM conversation.

## Throughput checkpoint

- Blocking first steps: read owning invariants, feature maps, existing artifact acknowledgement and Studio theme; install dependencies; record baseline gates.
- Independent workstreams: isolated `task-board` lane owns headless model, registry presentation and fictional example; isolated `present-task` lane owns task descriptors and native/browser acknowledgement. Parent integrates and reviews.
- Shared mutable state: integration serializes registry regeneration, migration notes and final gates. Heavy commands serialize through `/tmp/boring-ui-d417-heavy.lock`, each inside a MemoryMax=8G user scope.
- Smallest safe decomposition: two independent artifacts, joined by the existing host artifact callback. No new PM header/composer or Studio header component.

## Latest owner alignment

- One shared request card/chip for board, detail and PM confirmation cards, including capture/context and optional action slot.
- `filter="mine" limit={N} variant="compact"` gives latest requests as title/status rows.
- Width follows the board container, not viewport. Detail selection uses `?task=<id>`.
- Studio owns its fixed header and one switch naming the other side (`Tasks <plain count>` or `App`), icon actions and overflow. The example uses current Studio tokens and the real `pi-ambient`, not a replacement style or chat.

## Evidence

Raw local evidence: `.cache/evidence/d417/`. Baseline `npm run check` passes. Initial full `npm test` exceeded the 20-minute local command deadline during existing canvas tests; this is not recorded as passing. Final CI and bounded focused runs must establish their own results. No real-model or physical-phone qualification is implied by scripted browser journeys.
