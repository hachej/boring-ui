# research-cycle

A scheduled competitive-research and self-audit loop. One agent (`scout`), one skill (`research-cycle`).

## Layout on main

```
docs/research/
  register.md            living findings list, diffed run over run
  state/                 tracked.md · exclusions.md
  runs/<run>/
    harvest.md  ground.md  challenge.md  verify.md
    spikes/<topic>/      QUESTION.md · PINNED.md · src/ · test/ · RESULT.md
```

One short-lived branch per run — `research/<run>` → PR → merge. **No long-lived research branch:** it
never merges, so nothing reviews it, and spike evidence pinned to a diverging tree stops matching main.

## Why the structure exists

Each rule below was bought with a specific failure in the first deep cycle:

| Structure | Bought by |
|---|---|
| one finding = one table row, same columns everywhere | the register was hand-built by re-reading ~28,000 lines of prose; rows paste between report, register and issue unchanged |
| "Not run" section mandatory | three spikes had blocked model calls; silence would have read as success |
| "Contradicts" section | four recommendations were disproven and needed to overturn earlier entries |
| verification at call sites | "built, ratified, never wired" is invisible to anyone reading the defining module |
| mutation check in spikes | 17 green tests survived deleting the constraints they claimed to prove |
| defensive audit framing | an offensively-framed governance audit was blocked by a safety classifier |
| exclusions injected verbatim | without it, every run re-reports the last one |
| "a clean negative is a good result" | the most useful reports were refutations |
| demand a diff, not an estimate | "this breaks the client" became "12 files, +77/−106" only when a patch was required |
