ITERATION 2. Your previous pass proved two wire recommendations BREAK the real boring-ui ChatPanel:
  R1 opaque cursors -> "Expected number, received string" at `seq`; panel never connects
  R2 implicit session creation -> panel calls explicit create, 404, composer stays disabled
  R3 final-authoritative -> PARTIAL: recovery happens via numeric gap detect -> abort -> /state rehydrate
Your report is at /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/s3-wire-report.md. Read it; do not redo it.

NOW MAKE THEM WORK. A negative result told us the cost exists; this pass measures it exactly and proves
the fix. The deliverable is a WORKING PATCH plus a real line count, not an estimate.

RULES
- The front-end source is /home/ubuntu/projects/boring-ui-v2/packages/agent/src/front/** — treat the repo
  as READ-ONLY. Do not commit, do not modify the working tree.
- Instead, copy the front-end files you need to change into your spike workspace
  (/home/ubuntu/projects/spike-flue-celld/ui/patched/**), patch them there, and alias them in
  ui/vite.config.ts so the panel builds against YOUR patched modules. That gives a real, buildable,
  runnable proof without touching the repo.
- Keep a unified diff of every change: `diff -u original patched` into a patches/ directory.

DO THIS
1. R1 — opaque cursors. Find every place the client requires `seq` to be numeric or does arithmetic on
   it: the Zod schemas, piChatStream.ts, piChatReducer.ts, remotePiSession.ts, usePiSessions.ts.
   Change the type to an opaque string token, remove comparisons/increments, and make resume pass the
   token back verbatim. Prove the panel works end to end against the opaque-cursor shim mode.
2. R2 — implicit sessions. Make the panel able to send a first prompt WITHOUT an explicit create call
   (server adopts/creates on first send and returns the addressed ref). Prove the composer is enabled
   and the first message round-trips.
3. R3 — make `message-end.final` genuinely authoritative: a dropped delta should heal at message-end
   WITHOUT a gap-triggered abort and full rehydrate. Prove it by running drop-deltas mode and showing
   there is no rehydrate in the request trace.
4. Drive each with Playwright (Firefox worked last time; sockets are EPERM so keep your in-process
   fulfilment approach). Screenshot each into
   /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/shots

REPORT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/s3b-fix-report.md:
  - per recommendation: WORKS / STILL BREAKS, with the browser evidence
  - the exact files changed and REAL added/removed line counts from your diffs (not estimates)
  - anything you could NOT make work, and precisely why
  - which changes are backwards-compatible with a numeric-seq server and which force a coordinated
    server+client cutover — this determines whether L2 can ship incrementally or needs a flag day
That last point is the one I care most about.
No preamble.
