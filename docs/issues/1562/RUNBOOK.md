# Runbook — running epic #1562 through the Factory Hub

Verified 2026-09-07 evening. The hub is one process for the whole repo.

## Preconditions (all true as of 2026-09-07 19:50 UTC)

- PR #1561 merged to `main` (ratification + DIRECTION amendment + beads). If not merged, the Orchestrator must be told the epic is authorized by the owner in the request text.
- Hub running: `PORT=5220`, `AGENT_API_PORT=5230`, cwd `.worktrees/ask-user-nonblocking/apps/factory-playground`, workspace root = the canonical checkout, state root `.worktrees/factory-hub/apps/factory-playground/.factory-state`, provider `local-simulation`, all seats `openai-codex:gpt-5.6-sol`, demo host via Tailscale. Check: `ss -ltnp | grep 5220`.
- `br` on PATH (`br --version` → 0.2.16); `pnpm -s check:skill-digests` passes; codex logged in (`codex exec -m gpt-5.6-sol "ok"`).
- Beads: `br ready --db $REPO/.beads/beads.db | grep nc-` lists nc-0, nc-1, nc-t, nc-x; `br dep cycles --blocking-only` → 0.
- Disk ≥ 50 GB free on `/`, tmpfs ≥ 10 GB free, memory ≥ 15 GB available.

## Launch (one command, from the hub's cwd)

```bash
cd /home/ubuntu/projects/boring-ui-v2/.worktrees/ask-user-nonblocking/apps/factory-playground
node scripts/factory-epic.mjs up \
  --feature "Native Creation" \
  --key native-creation \
  --branch epic/native-creation \
  --request /home/ubuntu/projects/boring-ui-v2/docs/issues/1562/request.md
```

This registers the epic, creates `.worktrees/epic-native-creation` on `epic/native-creation` from `main`, and starts the Orchestrator session bound to `epic:native-creation`.

## Gate 1 (plan approval)

The Orchestrator validates the existing bead graph and raises one Inbox card `[br-…] Plan approval: Native Creation` with `docs/issues/1562/show-me-plan.md` attached. Answer `approve` in the hub Inbox (http://localhost:5220). To skip the card, add the literal sentence `Gate 1 pre-approved` to `request.md` before launch.

## Exec

Workers claim from `br ready` in priority order, commit only on `epic/native-creation`, hand off via a bead comment with SHA, sandbox proof and a `fresh_review` verdict. Watch: Agents (sessions), Tasks (claims), Automations (dispatches), `factory_status` from the Orchestrator. Caps: `BORING_FACTORY_MAX_CONCURRENT_WORKERS` (default 2 — raise to 3 for this epic), `_MAX_DISPATCHES_PER_BEAD=2`, `_MAX_REVIEW_ROUNDS=4`.

## Gate 2 (merge approval)

Raised once every bead is handed off and reviewed; the Orchestrator opens the epic PR with the Owner Review card and a `## Show me` section, starts a local demo, and asks. It never merges. You merge.

## If something is wrong

- Stale claim: `br update <id> --assignee "" --status open` then re-dispatch (or `recover_stale_claims`).
- Runaway Orchestrator turn: `POST /api/v1/agent/sessions/<id>/stop` then re-prompt.
- Empty reviewer verdicts: check the reviewer seat model is `openai-codex:gpt-5.6-sol`.
- No Inbox cards: the hub must keep `defaultPluginPackages: ['@hachej/boring-ask-user']`; a second blocking ask_user in one session supersedes the first.
