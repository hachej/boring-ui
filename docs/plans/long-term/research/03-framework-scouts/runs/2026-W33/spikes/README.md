# Spikes — 2026-W33

Six spikes. Each began from a refutation condition; three refuted something.

| spike | question | verdict | evidence |
|---|---|---|---|
| `pi-storage` | Can pi run on host-supplied storage at our pinned 0.80.7? | **confirmed** | two PIDs, real Gemini turns, continuity across process death, `~/.pi/agent/sessions` byte-identical |
| `durable-pause` | Can a tool-call pause survive a real process kill? | **confirmed** | SIGKILL, resumed in a different PID, 5/5 invariants constraint-enforced under mutation |
| `l0-schema` | Are the schema's invariants structural or adapter-deep? | **refuted, then fixed** | 17 green tests survived deleting two constraints; raw-SQL tests added, mutations now kill |
| `migration` | Can real pi transcripts be imported and continued? | **confirmed** | 4,229-line transcript round-tripped byte-exact; a real session continued under Gemini |
| `wire-fixes` | Do opaque cursors / implicit sessions / authoritative `final` work in the real ChatPanel? | **refuted, then fixed** | first pass: all three break. Second: all three work, 12 files, +77/−106 |
| `tool-catalog` | Does `call_tool` preserve tool identity in the event stream? | **refuted** | pi emits only `toolName:"call_tool"`; no event names the inner tool |

## Not run

- Live model calls inside worker sandboxes (vault + sockets denied). The orchestrator completed the live halves of `pi-storage` and `migration` by hand; `tool-catalog` used pi's faux provider plus a real serializer against a local mock, and its identity finding does not depend on the model.

## Where the code is

`~/projects/spike-{pi-storage,durable-pause,l0-schema,migration,flue-celld,tool-catalog}` — untracked local directories. Not yet pinned to a commit or committed anywhere.
