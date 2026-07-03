# Proof-of-work procedure

Every GitHub issue/PR implementation must leave auditable proof that the job is
done. A PR is not ready for human review until the agent posts a final GitHub
proof comment for the current head SHA.

PR-body proof, CI summaries, and local notes are useful context, but they do
not replace the final proof comment. If a run is read-only or lacks GitHub
access, report the missing proof comment as the blocker.

## Required proof comment

The final GitHub comment must include:

- **What changed** — concise file/behavior summary.
- **Test procedure** — exact commands run and pass/fail status.
- **Manual validation** — exact user-facing steps performed.
- **Evidence artifacts** — screenshots, saved artifact paths, logs, Playwright output, Showboat docs, or Rodney output where relevant.
- **Workspace playground validation** for workspace/UI behavior — Vite port, API port, PID, log path, stop command, and manual test steps.
- **Known gaps** — anything not verified, flaky, skipped, or blocked.

Public repo safety: **never post host/IP addresses**. Post only ports and local/operator paths.

## Workspace playground validation

Behavior changes in workspace UI, panels, filetree/editor/media viewers, plugin reload/runtime plugins, command palette, or shortcuts require `workspace-playground` validation in addition to tests.

Use issue-specific ports. Suggested convention:

- Vite: `52XX`
- API: `53XX`
- `XX` = last two digits of the issue number

Launch from the PR worktree:

```bash
PORT=52XX \
AGENT_API_PORT=53XX \
BORING_AGENT_WORKSPACE_ROOT=/tmp/boring-ui-playground-ISSUE \
nohup pnpm --filter workspace-playground dev \
  > /tmp/boring-ui-playground-ISSUE.log 2>&1 &
echo $!
```

Verify locally with loopback only:

```bash
curl -I http://127.0.0.1:52XX
```

In GitHub comments, write only:

```md
Playground validation:
- Vite port: `52XX`
- API port: `53XX`
- PID: `12345`
- Log path: `/tmp/boring-ui-playground-ISSUE.log`
- Stop: `kill 12345`
- Manual test steps:
  1. ...
  2. ...

No public host/IP posted.
```

## Simon Willison proof-artifact tools

Use these tools when they improve evidence quality:

- **Showboat** (`uvx showboat`) builds reproducible proof documents with commands and captured output.
- **Rodney** (`uvx rodney`) drives Chrome from the shell and can capture screenshots, DOM assertions, accessibility checks, and browser state.

Recommended UI proof flow:

```bash
# Create proof document.
uvx showboat init /tmp/boring-ui-proof-ISSUE.md "Proof for issue ISSUE"
uvx showboat exec /tmp/boring-ui-proof-ISSUE.md bash "curl -I http://127.0.0.1:52XX"

# Capture browser evidence.
uvx rodney start --local
uvx rodney open http://127.0.0.1:52XX
uvx rodney waitstable
uvx rodney screenshot /tmp/boring-ui-proof-ISSUE.png
uvx showboat image /tmp/boring-ui-proof-ISSUE.md /tmp/boring-ui-proof-ISSUE.png
uvx showboat verify /tmp/boring-ui-proof-ISSUE.md
uvx rodney stop
```

If a screenshot is not possible, explain why and provide the strongest available evidence: Showboat proof doc, Rodney assertion, DOM assertion, Playwright trace, curl status, log excerpt, or explicit manual steps.

## Proof comment template

```md
Proof of work

What changed:
- ...

Automated verification:
- `command` ✅
- `command` ✅

Manual validation:
1. ...
2. ...

Playground validation:
- Vite port: `52XX`
- API port: `53XX`
- PID: `12345`
- Log path: `/tmp/boring-ui-playground-ISSUE.log`
- Stop: `kill 12345`

Artifacts:
- Screenshot: `/tmp/boring-ui-proof-ISSUE.png`
- Showboat proof: `/tmp/boring-ui-proof-ISSUE.md`

Known gaps:
- None / ...

No public host/IP posted.
```
