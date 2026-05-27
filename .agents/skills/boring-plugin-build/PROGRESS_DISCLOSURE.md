# Boring Plugin Build — Progress Disclosure

This skill should report progress in small, meaningful steps.

## Suggested format

At start:

```txt
Plan:
1. Choose plugin shape
2. Create/update plugin files
3. Register the plugin correctly
4. Verify the integration path
```

After choosing shape:

```txt
Progress:
- Shape chosen: <runtime|app/internal>
- Why: <one sentence>
- Next: <scaffold/build/register>
- Caveat: <provider/binding or core appPackageJsonPath issue if relevant>
```

When blocked:

```txt
Blocked:
- Missing decision: <what>
- Why it matters: <one sentence>
- Safe default if you want me to choose: <default>
```

At finish:

```txt
Plugin report:
- Shape used:
- Files added/updated:
- Registration path:
- Verification run:
- Restart/reload requirement:
```

## Rule

Do not just say “plugin added.”
Say:

- what shape it is
- how it loads
- whether it needs `/reload` or restart/redeploy
