PROVE OR DISPROVE two wire recommendations against the REAL boring-ui chat front-end. Executable spike.

THE RECOMMENDATIONS
  R1 "Opaque cursors" — clients receive a resume token, pass it back verbatim, and NEVER derive or
     compare offsets arithmetically. Claim: this deletes client cursor arithmetic and a class of
     replay-gap bugs.
  R2 "Implicit session creation" — the first send creates the session; no explicit create call; the
     'no session yet' UI state stops existing.
  R3 "message-end.final is authoritative, deltas advisory" — a dropped delta self-heals at message-end
     instead of being a protocol error.

YOU ALREADY HAVE A WORKING RIG — reuse it, do not rebuild:
  /home/ubuntu/projects/spike-flue-celld
    - src/shim.ts        an AgentGateway->Flue translation shim serving the routes the panel needs
    - ui/                a Vite app rendering the REAL ChatPanel from @hachej/boring-agent/front
                         (aliased to /home/ubuntu/projects/boring-ui-v2/packages/agent/dist)
    - the shim currently serves NUMERIC seq cursors and EXPLICIT session creation
  Start it: the celld node may be down. Simpler and better for this spike: run the shim as a plain
  Node/Hono server on a port (extract or re-host the handlers) — celld is irrelevant to the question.
  UI dev server: cd ui && npm run dev  (vite, port 5199, --host already set)

DO THIS:
1. Get the rig running and the real ChatPanel talking to the shim. Confirm a baseline message round trip.
   (A model key: export VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$(cat ~/.vault-token);
    GEMINI_API_KEY=$(vault kv get -field=api_key secret/agent/gemini). The Anthropic key has NO credits.)
2. R1: change the shim to emit OPAQUE cursors — e.g. an HMAC'd or base64 token the client cannot parse
   or increment. Do NOT change the front-end. Observe: does the real panel still work? Where exactly
   does it break? Quote the front-end code that assumes a numeric seq
   (look at packages/agent/src/front/chat/pi/piChatStream.ts and piChatReducer.ts on origin/main).
   The finding is the LIST of places the client does arithmetic on the cursor.
3. R2: make the shim create sessions implicitly on first send and REMOVE the explicit create route.
   Does the panel cope, or does it hard-require an explicit create? Quote the code path.
4. R3: deliberately DROP a fraction of delta events in the shim while still emitting a correct
   message-end.final. Does the panel self-heal, or does it show a corrupted/missing message? This is
   the decisive test for "deltas advisory".
5. Drive the UI with playwright to observe each case. Playwright is installed in
   /home/ubuntu/projects/boring-ui-v2 (run node scripts from that cwd so 'playwright' resolves).
   Take a screenshot per case into .

REPORT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/s3-wire-report.md: for R1, R2, R3 — WORKS / BREAKS / PARTIAL, the exact front-end code that
decides it, what would have to change in packages/agent/src/front, and a rough line estimate for each.
Paste real observations and reference the screenshots. A clean negative is a good result.
No preamble.
