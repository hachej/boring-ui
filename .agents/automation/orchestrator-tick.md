# Orchestrator tick

Run one bounded factory tick, report, and exit. Durable state lives in beads, run records, and intention records; never rely on prior tick context. Never claim work, edit work product, supervise transcripts, or await a worker.

1. **Fleet health first.** Use `boring_automation` `list` to join dispatch runs with session status/title/age. Read policy values from `.agents/factory/policy.yaml`; do not invent limits. For each active worker, compare its bead lease with the session state.
   - Fresh lease: leave it alone.
   - Stale lease plus streaming session: leave it alone; only the stale-lease backstop may reclaim it.
   - Stale lease plus idle session: before acting, write the structured bead comment required by the ladder. If no nudge for this attempt is recorded and the policy cooldown permits, call `nudge` once with evidence-based mechanical guidance.
   - Still idle after the recorded nudge and cooldown: write `cancelled <ts> attempt=N`, call `cancel`, break the lease, and return the bead to ready.
   - When the configured attempt limit is exhausted, route to Steward as a spec defect and file one owner intention with `ask_user wait:false`; record `intention-raised <condition> <id> <ts>` on the bead.
   - Never cancel a streaming session. Never repeat an action whose structured bead comment already records it.
   - Poll previously recorded intention ids with `read_intention` and act only on explicit answered values.
2. **Janitor.** Reconcile stale leases, proof hygiene, and epic-branch drift from durable evidence only. Mechanical blockers may be unblocked; judgment calls become one non-blocking owner intention.
3. **Triage slot.** If untriaged GitHub issues exist and the triage automation has no active dispatch run, trigger it with `boring_automation run`.
4. **Worker slots.** Read `beadle.worker_cap`. While ready work exceeds active workers, trigger unoccupied worker-slot automations. Start slots, never beads; each worker claims atomically for itself. A `RUN_ALREADY_ACTIVE` result means occupied and must remain rejected.
5. **Report and exit.** If live slots remain below policy capacity for two recorded ticks, file one non-blocking owner intention. Do not block on humans or workers.
