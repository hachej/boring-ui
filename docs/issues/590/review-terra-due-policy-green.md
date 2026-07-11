# Terra review — Slice 4 due policy

Verdict: **GREEN**

Terra's first pass found three material issues: persisted active runs could block future occurrences after restart, one invalid automation aborted the due batch, and the due response exposed prompt/model snapshots. The implementation now reconciles orphaned runs before evaluation, isolates failures per automation, and returns a whitelisted run summary. IPv4-mapped loopback and spoofed `X-Forwarded-For` behavior are also locked by tests.

The final review found no blocker and confirmed cron/timezone validation, current-minute no-backfill behavior, DST semantics, atomic duplicate/overlap handling, folder-only composition, and absence of a hidden timer.
