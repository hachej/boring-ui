# Proof of work

Every implementation needs auditable proof. Do not say “tested” without evidence.

## Accepted proof types

Use at least one; use more when risk is higher.

- **Exact command** — command run, result, and short output summary.
- **Screenshot/demo** — artifact/URL plus what to inspect.
- **Manual steps** — exact reproduction or verification path.
- **Waiver** — why proof is not possible or not worth the cost, plus residual risk.

## PR proof comment

Before owner review or merge, post proof for the current PR head SHA.

```md
Proof of work

What changed:
- ...

Automated verification:
- `command` ✅/❌

Screenshot/demo:
- ... / N/A

Manual validation:
1. ... / N/A

Waiver / known gaps:
- None / ...
```

## UI proof

For UI/workspace behavior, prefer a screenshot or demo plus manual steps. If using a local playground, never post public host/IP addresses. Ports, local/operator paths, and safe preview URLs are OK.

Useful artifact tools when needed:

- `uvx showboat` for command/evidence documents.
- `uvx rodney` for browser screenshots and assertions.
