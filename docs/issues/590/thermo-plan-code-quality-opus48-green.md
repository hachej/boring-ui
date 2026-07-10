GREEN

- **Nullable type sketch reconciled**: `AutomationRun` (lines 96–114) now uses explicit `| null` on every nullable field, and line 117 codifies the rule ("nullable persisted fields use explicit `null` consistently rather than JSON-only 'missing property means cleared'"). This aligns cleanly with the SQL-incompatible absent-key patch blocker (line 291) and Decision 5/6 — no contradiction remains.
- **Review pointers resolve**: The three Loop Exit pointers (lines 288–290 → initial / pass2 / final) all point to files that exist on disk; no dangling references.
- Minor, non-blocking: `thermo-plan-code-quality-opus48-green.md` exists but is intentionally not cited (superseded by `-final`); worth a one-line note only if you want the artifact trail exhaustive — not required for GREEN.
