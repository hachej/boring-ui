# Review Loop Procedure

Use this before a PR is ready for merge or human review.

## Pick Target

Dirty uncommitted work:

```bash
/home/ubuntu/.agents/skills/coding-autoreview/scripts/autoreview --mode local
```

PR or branch work:

```bash
base=$(gh pr view --json baseRefName --jq .baseRefName 2>/dev/null || echo main)
/home/ubuntu/.agents/skills/coding-autoreview/scripts/autoreview --mode branch --base "origin/$base"
```

One finished commit:

```bash
/home/ubuntu/.agents/skills/coding-autoreview/scripts/autoreview --mode commit --commit HEAD
```

## Loop

1. Run the selected review command.
2. Verify each finding against the real code path.
3. Fix every accepted finding; reject only with a concrete reason.
4. Rerun affected tests/proof when code changed.
5. Rerun the same review target until clean or blocked.
6. Record the reviewed head SHA.

For non-trivial implementation code, also use
`coding-thermo-nuclear-code-quality-review` as a bounded helper and apply the
same accept/fix/re-review rule.
