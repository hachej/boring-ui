# Outcome

Compact titles now prefer authored display, otherwise the complete original need, without word-count clipping. No props, authorization, actions, chip or operator-card changes. Concise localized metadata still needs producer authoring/backfill; this fix does not claim every legacy title has six words.

## Evidence
Both public regressions failed against 0.4.40 and pass after the fix. Five wrapper tests pass (including ten native TaskBoard cases and three PM action cases), static checks/registry generation, contract tsc and strict registry TSX pass. Twelve fictional native screenshots cover phone/desktop, FR/EN, light/dark, legacy wrapping, actions and original detail. No models or live posts. CI and real app adoption remain separate.
