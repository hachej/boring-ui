<!-- Copy into spikes/<topic>/. A spike that cannot be refuted is a demo. -->

# Spike — <topic>

## Question

**Hypothesis:** <what we believe>
**Refuted if:** <the concrete observation that would kill it>
**Why reading cannot settle it:** <undocumented behaviour, concurrency, real provider, etc.>

## Pinned

repo `<sha>` · node `<v>` · packages `<name@version, …>` · model `<id>`

## Result

**Verdict:** <confirmed | refuted | inconclusive>

<!-- Pasted REAL output. Never a description of output. -->
```
$ npm test
…
```

**Not proven:** <what the run could not establish — a blocked model call is a limitation, not silence>

## Mutation check

<!-- Required only if the spike claims an invariant is *structural*.
     Remove the constraint, show the targeted test fails, restore. -->

| removed | result |
|---|---|
| `<constraint>` | targeted test fails ✓ |
