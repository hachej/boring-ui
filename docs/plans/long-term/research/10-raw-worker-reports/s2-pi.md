PROVE OR DISPROVE the central architectural claim of a plan. This is an executable spike, not analysis.

THE CLAIM (from reading Flue's source): "pi can be constructed with an in-memory messages array and a
host-supplied durable writer; pi's own persistence is not used; the host's record stream is the only
truth." Flue does this — but Flue depends on @earendil-works/pi-agent-core ^0.83.0.

THE QUESTION THAT MATTERS: **can we do it with what we are pinned to?**
boring-ui depends on @mariozechner/pi-coding-agent@0.80.7 (an alias of @earendil-works/pi-coding-agent).
Available on disk: /home/ubuntu/projects/boring-ui-v2/node_modules/@mariozechner/pi-coding-agent
(a symlink into .pnpm — follow it). Look for @earendil-works/pi-agent-core and pi-ai in the same store:
  ls /home/ubuntu/projects/boring-ui-v2/node_modules/.pnpm | grep -i earendil
A prior audit claims pi-agent-core exposes injectable `SessionStorage` / `SessionRepo` / `Session`,
and that pi-coding-agent's `SessionManager` is file-backed and fixed. VERIFY THAT — do not trust it.

WORKSPACE: /home/ubuntu/projects/spike-pi-storage  (empty; scaffold it yourself — package.json type:module, vitest or plain node scripts).
You may install packages from npm, including a NEWER pi-agent-core if that is what it takes — but if the
pinned 0.80.x cannot do it and a newer one can, that is the single most important finding and must be
stated loudly.

DO THIS, in order, and report what actually happened at each step:
1. Enumerate the real exports of pi-agent-core and pi-coding-agent at the version(s) on disk. Which
   session/storage interfaces are public? Paste the .d.ts signatures.
2. Write a MINIMAL custom `SessionStorage` backed by an in-memory Map (or a SQLite table). Nothing
   fancy — it must merely satisfy the interface.
3. Construct pi with it and RUN A REAL TURN. Model: use google/gemini-2.5-flash; get the key with
     export VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$(cat ~/.vault-token)
     GEMINI_API_KEY=$(vault kv get -field=api_key secret/agent/gemini)
   (An Anthropic key exists but has NO CREDITS — do not use it.)
   Prove the turn ran: paste the assistant's actual reply.
4. Prove the host store, not pi's files, holds the truth: assert NOTHING was written to pi's default
   session directory during the run. Say exactly how you verified that.
5. Kill the process, construct a NEW pi instance from the same host store, and continue the
   conversation. Prove continuity: the second turn must demonstrate memory of the first.
6. Report what pi still demands from the host that the claim glosses over: filesystem? cwd? clock?
   tool environment? Anything that would not exist in a constrained runtime.

DELIVERABLES in /home/ubuntu/projects/spike-pi-storage: the scaffold, the storage adapter, a runnable script/test, and NOTES.md.
FINAL REPORT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/s2-pi-report.md: a blunt VERDICT — is the Flue pattern available to us on the pinned
version, on a newer version, or not at all? — then the evidence, the signatures, the pasted model
output, and every caveat. Paste real command output; do not describe it.
If it does not work, say so plainly and say exactly what blocked it. A clean negative is a good result.
No preamble.
