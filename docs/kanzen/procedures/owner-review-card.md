# Owner Review Card Procedure

Use this when a PR needs Julien or owner review instead of fast-track merge.

Post the final proof comment first, following
[`proof-of-work.md`](proof-of-work.md). Then leave this card in the PR and final
thread:

```text
PR:
Issue:
What changed:
Why:
Risk:
Proof:
Demo: URL or N/A
Please test:
Decision needed:
```

`Proof` summarizes or links to the final proof comment; it does not replace it.

Use `Demo` for a preview/dev URL when safe and relevant. For public GitHub
comments, follow the proof-of-work safety rule: never post host/IP addresses;
use ports, local/operator paths, or a safe preview URL.

Make `Please test` concrete enough that Julien can approve, reject, or request a
specific change without reconstructing the whole PR.
