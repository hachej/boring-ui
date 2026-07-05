# B1 — Host Seam Fork Plan

## Today / Delta

Today, upstream `tmustier/pi-for-excel` is Excel-bound. The manifest declares `Host Workbook` (`manifest.xml:19-21`). The runtime wraps `Excel.run` (`src/excel/helpers.ts:23-29`), builds workbook context from Office workbook state (`src/workbook/context.ts:10-43`), reads Excel selection (`src/context/selection.ts:31-98`), tracks worksheet changes (`src/context/change-tracker.ts:21-98`), and coordinates Excel mutations/recovery (`src/workbook/coordinator.ts:56-219`, `src/workbook/recovery-log.ts:55-220`, `src/tools/mutation/finalize.ts:13-50`).

Delta: fork to `hachej/pi-for-office`, preserve Excel behavior, and extract a `DocumentHost` seam around those host-coupled joints. Add PowerPoint manifest support and host detection, but leave PowerPoint tools to B2.

The requested PowerPoint feasibility report was unavailable in this session. This plan uses verified upstream source files instead.

## Fork Discipline

- Origin is `hachej/pi-for-office`.
- Upstream remote is `tmustier/pi-for-excel`.
- New hosts live in new directories.
- Shared-file edits must be minimal and justified in PR description.
- Merge upstream at the start of every B-lane PR.
- Record conflicts and resolution notes in the fork docs.

## DocumentHost Seam

Create a host contract that covers:

- Run wrapper.
- Context injection and document identity.
- Selection reader.
- Change tracker.
- Mutation coordinator and recovery checkpoints.

Excel implements the seam by wrapping existing code first. No Excel behavior changes are allowed in B1 except through the seam adapter.

## PowerPoint Detection

B1 only proves that the fork can recognize PowerPoint:

- Manifest includes `Host Presentation`.
- Host detection selects `PowerPointDocumentHost`.
- PowerPoint adapter can return basic document identity and a clear "tools not implemented until B2" response.

## Upstream RFC

Open an upstream RFC issue proposing the seam before or with the fork PR. The RFC should be narrow: make pi-for-excel host-extensible without requiring upstream to own PowerPoint immediately.

## Exit Criteria

- Excel test/build remains green.
- The Excel host runs through `DocumentHost`.
- PowerPoint host is detected from the add-in host.
- No B2 PowerPoint tool implementation leaks into B1.
- Fork docs explain upstream merge cadence and shared-file discipline.

