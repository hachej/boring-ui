# Boring App Setup — Progress Disclosure

This skill should use **progress disclosure**.

Meaning:

- start with the big picture
- only reveal the deeper sub-steps when you enter that phase
- keep the user updated without dumping every implementation detail up front

## Default status format

At the start:

```txt
Plan:
1. Choose the base app
2. Scaffold and rename the app
3. Wire identity/config/env
4. Add plugin integration if needed
5. Verify locally
6. Prepare deploy/manual handoff
```

At each phase boundary:

```txt
Progress:
- Phase: <name>
- Done: <1-3 bullets>
- Next: <1-2 bullets>
- Waiting on human: <none or exact item>
- Risk/unknown: <none or exact item>
```

At a manual stop:

```txt
Blocked on manual step:
- Area: <domain|db|mail|deploy|oauth>
- Needed from you: <exact artifact or decision>
- I can continue once I have: <exact input>
```

At the end:

```txt
Ship report:
- Base app used:
- App identity wired:
- Plugin path used:
- Verification run:
- Manual steps remaining:
- Known limitations:
```

## What good progress disclosure looks like

Good:

- “Scaffold done. Next I’m wiring identity and env templates.”
- “Plugin package is built. I still need you to provide the production domain so I can finalize `BETTER_AUTH_URL` and `CORS_ORIGINS`.”

Bad:

- “Still working.”
- giant dump of every future step before phase 1 begins
- saying “done” before manual provider work is clearly separated

## Rule

Do not make the user reverse-engineer the current state.
Always tell them:

1. where you are
2. what changed
3. what remains
4. whether anything is now waiting on them
