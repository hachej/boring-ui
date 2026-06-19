---
name: boring-feedback
description: "Use this skill when a user submits /feedback inside boring-ui or installs the @hachej/boring-feedback plugin: capture and redact context, decide whether to create a GitHub bug issue or a GitHub Project backlog item, optionally grill/refine the report with targeted questions, and leave unclear entries in status:needs-grill until the user answers."
---

# Boring Feedback

Handle `/feedback` intake. Do not implement. Capture, enrich, route, and queue.

## Entry Points

- `/feedback <report>`: treat the command args as the user report.
- `/feedback` with no args: ask for the report first.
- direct user request: use the same flow when the user asks to capture feedback.

The `@hachej/boring-feedback` plugin may open a feedback panel, but the agent
workflow is still the source of truth for GitHub/project mutations.

## Workflow

1. Create a local draft.
2. Auto-enrich it with safe context.
3. Show redaction preview before anything leaves the workspace.
4. Classify the report as bug, backlog idea, question, or unclear.
5. Decide whether to grill now, defer grill, or skip grill.
6. Create the GitHub issue or GitHub Project backlog item.
7. Set the initial status for the scheduled triage loop.

## Auto-Enrichment

Capture only safe context by default:

- user report and optional title;
- current route, workspace id, active panel/plugin, selected file/item;
- app version, commit SHA, branch, runtime mode;
- browser, OS, viewport;
- recent UI command or bridge command when relevant;
- redacted console errors and failed network requests;
- optional screenshot/DOM snapshot after preview;
- recent agent/session id when feedback concerns an agent run.

Never publish secrets, cookies, auth headers, API keys, private customer data,
raw transcripts, unrelated user content, or full local paths outside the repo.

## Route

Create a GitHub issue when the feedback describes a bug:

- broken existing behavior;
- regression;
- crash/error;
- data loss or permissions problem;
- UI state that contradicts expected behavior;
- reproduction is likely from captured context.

Create a GitHub Project backlog item when the feedback is not yet a bug:

- product idea;
- UX improvement;
- vague frustration;
- question;
- feature request;
- needs product shaping before issue-worthy work exists.

When uncertain, prefer backlog item plus `status:needs-grill` over creating a
low-quality bug issue.

## Grill Choice

After preview, present the user with the proposed entry and targeted questions.
Offer three choices:

```text
Grill now: answer the questions before creating/routing the entry.
Defer grill: create the entry now with status:needs-grill.
Skip grill: create the entry with current context and status:to-triage.
```

Ask only useful questions. Prefer 3-5 targeted questions, such as:

- What were you trying to do?
- What happened instead?
- What did you expect?
- How often does it happen?
- Is there a concrete example, file, PR, or screen I should attach?

If the user chooses "defer grill", store the questions on the backlog item or
issue body and set:

- `source:feedback`
- `status:needs-grill`

If the user answers enough detail, create the item with:

- `source:feedback`
- `status:to-triage`

Bug issues may also get `bug`, `ux`, `plugin:*`, or `package:*` when confident.

## Output Shapes

GitHub bug issue body:

```text
User report:
Observed:
Expected:
Captured context:
Artifacts:
Redaction note:
Grill state: complete|deferred|skipped
```

Project backlog item body:

```text
Feedback:
Why it might matter:
Captured context:
Open questions:
Grill state: complete|deferred|skipped
```

## Handoff

Scheduled triage picks up created items later.

- `status:needs-grill`: wait for user answers; do not implement.
- `status:to-triage`: ready for `boring-triage`.
- `bug` + `status:to-triage`: likely issue path.
- backlog item + `status:to-triage`: product/UX shaping path.

Do not start a worker from `/feedback`.
