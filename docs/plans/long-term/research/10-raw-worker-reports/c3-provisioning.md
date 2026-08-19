ADVERSARIAL REVIEW of a workspace/runtime PROVISIONING system. Find where it breaks, corrupts, races,
or silently degrades. Concrete failing sequences beat concerns.

CODEBASE: /home/ubuntu/projects/boring-ui-v2, read from `origin/main` (`git show origin/main:<path>`).
The working tree is 636 commits stale — using it is an error.

SURFACE UNDER REVIEW
  packages/agent/src/server/workspace/provisionRuntime.ts
  packages/agent/src/server/workspace/provisioning/**          (packArtifact.ts, skills.ts, …)
  packages/agent/src/server/runtime/modes/provisioningAdapter.ts
  packages/agent/src/server/runtime/**                          (resolveMode.ts, runtimeBindingLifecycle.ts)
  packages/agent/src/server/agent-host/runtimeScopeIdentity.ts  (provisioning fingerprint)
  packages/agent/src/server/agent-host/environmentLease.ts      (lease keyed by scope + fingerprint)
  packages/boring-sandbox/src/providers/**                      (bwrap, runsc, direct, vercel-sandbox)
  docs/runtime-provisioning.md and packages/agent/docs/** where relevant

ATTACK
1. **Partial provisioning.** Provisioning fails halfway — after the workspace exists but before skills
   or the bash bundle land. What state is the system left in? Is it retried, resumed, or does a
   degraded workspace serve requests? Trace the actual code path and name the observable symptom.
2. **Concurrency.** Two requests provision the same workspace scope simultaneously. Two different agent
   types in one workspace. A provision racing a lease acquisition. A provision racing a delete or
   drain. For each: what serialises it, and if nothing does, what corrupts?
3. **The provisioning fingerprint.** What exactly goes into it, and what does NOT? Find an input that
   changes real behaviour but does not change the fingerprint — that is a stale-environment bug. Then
   find an input that changes the fingerprint without changing behaviour — that is unnecessary lease
   churn. Both are findings.
4. **Idempotency.** Is provisioning safe to run twice? Three times, interleaved? What happens on
   re-provision over a workspace with local modifications, or with a running process holding files?
5. **Failure attribution.** When provisioning fails, does the developer learn WHICH step and WHY, or a
   generic error? Grade the messages ACTIONABLE / VAGUE / MISLEADING with quotes.
6. **Cleanup and leaks.** Sandboxes, temp dirs, file handles, child processes, lease records on: crash
   mid-provision, host restart, workspace delete, lease expiry. What is never reclaimed?
7. **Cross-mode assumptions.** direct vs bwrap vs runsc vs vercel-sandbox — find a place where code
   assumes one provider's semantics (paths, mounts, exec, lifetime, writability) and would misbehave on
   another. Especially: assumptions that hold locally and fail in a hosted sandbox.
8. **Trust.** Can anything an agent writes inside the workspace influence a subsequent provisioning
   decision, package resolution, or skill discovery? That is a self-escalation path.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/c3-provisioning-attack.md
Per finding: severity (FATAL/SERIOUS/MINOR), the exact failing sequence, file:line evidence, and a
concrete fix. End with the three you would fix first and why. Mark UNVERIFIED anything you could not
establish from code rather than guessing.
No preamble. 400-800 lines.
