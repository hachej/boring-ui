# Owner review card

After proof/reviews, create an Inbox Human Intention tied to the exact bead,
task, artifact, and revision — subject carries the bead ID
(`[br-###]`, per the factory's thread=bead correlation rule). That durable
record — not chat — is the decision source of truth. Use `ask_user` for the
decision transport when available (GitHub comment fallback):

```md
## Owner Review
Bead / PR / issue:
What changed / why:
Risk / rollback:
Proof / review links:
Artifact: <running UI demo or best non-UI proof file>
Please test:
1. <exact step>
Decision: approve | request changes | defer | reject
```

For UI, keep the playground/demo running and include desktop/mobile checks. For
other work, attach the most useful artifact and validation steps. Request-changes
resumes the same task/PR loop with a new artifact/revision; do not overwrite prior
review evidence. Never merge without explicit approval.
