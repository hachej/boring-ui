You are reading SOURCE CODE, not documentation. Two open-source agent frameworks; the docs have already
been analysed and the gaps are implementation-level.

TARGETS
A) withastro/flue (Flue 2.0.x) - https://github.com/withastro/flue
B) vercel/eve (0.31.x) - https://github.com/vercel/eve

FETCHING: `curl -sL --max-time 30 "https://r.jina.ai/<github file URL>"` works for GitHub pages. For
raw files prefer https://raw.githubusercontent.com/<org>/<repo>/main/<path> which usually fetches
directly with plain curl. You may also `npm pack <pkg>@<version>` into a temp dir and untar to read
shipped dist/.d.ts - do that if GitHub is rate-limited. Note eve requires node>=24 to RUN but you only
need to READ it.

PRIORITY 1 - Flue's pi adaptation. Cloudflare's engineering blog points at
`packages/runtime/src/session.ts` as "how Pi, the underlying harness, is adapted to work on Cloudflare
Agents SDK". Read that file and its neighbours. Answer precisely:
  - Which pi packages/entrypoints does Flue import? (pi-agent-core, pi-ai, anything else)
  - What does Flue have to SUPPLY that pi normally provides itself (storage, fs, exec, fetch, clock)?
  - What pi functionality does Flue bypass or reimplement, and why is that visible in the code?
  - What is the exact seam between Flue's durable execution and pi's turn loop?
  - Does anything there require node builtins? If so which, and are they shimmed?
This is the single most valuable section: it is the empirical answer to "how portable is the pi core".

PRIORITY 2 - Flue durable execution internals: submissions, attempts, leases, settlement, the recovery
classifier, and the tool-batch repair logic. Name the files and the functions. Quote the classifier.

PRIORITY 3 - eve internals:
  - the filesystem scanner/loader that turns a directory into an agent (build-time or runtime? what
    validation? how are naming collisions and drift detected?)
  - the durable step journal and retry machinery
  - the human-input pause: how `input.requested` / `session.waiting` are journaled and resumed, and
    exactly how a stale approval response is detected and demoted
  - the sandbox backend contract (interface shape) and which backends implement it

PRIORITY 4 - for BOTH: how much of the framework is genuinely portable vs bound to its host platform
(Cloudflare DO / Vercel Workflow). Give a rough line-count split if you can compute one.

REPORT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/r5-source.md
For every claim cite `repo/path/file.ts` and, where useful, quote 3-15 lines. If a file cannot be
fetched, say so explicitly rather than guessing. Terse, dense, code-first. No preamble. 600-1200 lines.
