VERIFY OR REFUTE a specific security claim against a specific OPEN PULL REQUEST. This must be settled
from code, because if the claim is true it blocks a merge, and if it is false we have cried wolf on
someone's work.

THE CLAIM (from an adversarial safety review, research/w16-safety.md):
> "Our runsc in-guest path walk is excellent, but the host bind source can still change before container
> mount. Issue 1123's one-time realpath is still check-then-bind unless backed by stable handles or
> provider primitives."

WHAT #1123 CLAIMS (docs/issues/1123/plan.md, r3.1, in /home/ubuntu/projects/boring-ui-v2 on origin/main):
> "resolveEnvironmentMounts realpath-resolves every sourceRoot exactly once at pair create; resolved
> paths are re-bound verbatim per exec (bwrap re-spawns per command — per-exec re-resolution would
> reopen the TOCTOU race). Missing/non-dir/workspace-aliasing sources (incl. symlink escapes) fail with
> stable SANDBOX_MOUNT_INVALID."

THE CODE UNDER REVIEW: PR #1166 (`#1123 feat(env): slice 1 — environment mount contract + provider
substrate`). Fetch the diff: `gh pr diff 1166` and `gh pr view 1166`. Also read the merged state of
packages/boring-sandbox/** on origin/main for surrounding context.

SETTLE THESE, from code
1. Where exactly does `resolveEnvironmentMounts` call realpath, and where does the bwrap bind actually
   happen? Quote both with file:line. How much wall-clock and how many syscalls separate them?
2. Between resolve and bind, what could change on the HOST: the final component swapped for a symlink,
   an intermediate directory replaced, a bind-mount shadowing, a rename? Construct the concrete attack
   with the exact sequence, and say who would need what access to perform it.
3. Does bwrap's own bind resolution re-walk the path at bind time, or does it trust the resolved string?
   Check bwrap's semantics, not just our code. This may make the claim moot — or confirm it.
4. The plan says per-exec re-resolution would REOPEN a race. Is that reasoning sound? Compare the two
   races: resolve-once-then-bind-many vs resolve-per-exec. Which is actually worse, and why?
5. Would `O_PATH` file descriptors, `openat2(RESOLVE_NO_SYMLINKS|RESOLVE_BENEATH)`, mount-fd APIs
   (`fsopen`/`fsmount`/`move_mount`), or bwrap's own `--bind-fd`-style options close it? Which are
   available in the runtimes we target (bwrap and runsc/gVisor)? Be specific about kernel and runtime
   support, and mark UNVERIFIED where you cannot confirm.
6. What is the actual exploitability? Who can write to the host bind sources — the agent itself, another
   tenant, a co-located process? If nobody untrusted can touch them, this is a hardening item, not a
   blocker. SAY WHICH.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/a2-toctou-verdict.md
A single clear verdict: CONFIRMED (with the attack sequence and exploitability), REFUTED (with the code
that closes it), or UNVERIFIABLE (with exactly what you could not determine and how to settle it).
Then, if confirmed, the minimal fix expressed as a diff against PR #1166, and whether it must land in
slice 1 or can follow.
Do not hedge. A wrong "confirmed" is as costly as a missed vulnerability.
No preamble. 300-700 lines.
