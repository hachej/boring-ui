ADVERSARIAL VERIFICATION. A one-page plan document makes claims sourced from the Flue framework and
from a survey of other agent frameworks. Your job is to FALSIFY them. Hunt for overstatement,
misquotation, and claims that do not survive contact with the primary source.

THE DOCUMENT: /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/plan.html (plain HTML, read it directly)

SOURCES
- Flue docs, OFFLINE and authoritative, from /home/ubuntu/projects/spike-flue-celld:
    npx -y @flue/cli@2.0.3 docs            # index
    npx -y @flue/cli@2.0.3 docs read <path>
- Flue source: raw.githubusercontent.com/withastro/flue/main/<path>, or `npm pack @flue/runtime@2.0.3`
  and read the shipped dist/.d.ts. Fetch web pages with curl -sL "https://r.jina.ai/<url>".
- Prior research reports (treat as SECONDARY — verify their claims too, do not inherit them):
  /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/r1-flue.md, r5-source.md, r6-field.md

CHECK EVERY ONE OF THESE:

F1. "Flue... pi gets an in-memory `messages` array and NEVER PERSISTS; a `ConversationRecordWriter`
    is injected; their record stream is the only truth." Verify against Flue SOURCE, not docs and not
    the prior report. Does `ConversationRecordWriter` exist by that exact name? Is pi genuinely given
    an in-memory array? Is "never persists" accurate, or does pi still write something?
F2. The document's schema section claims eleven frameworks agree on an intersection containing:
    submission (admitted_at before model work, idempotency_key, one terminal outcome, incarnation),
    an append-only record stream with opaque cursor, and a pause record.
    - Is `incarnation` a real Flue concept? Exact name and semantics?
    - Is `idempotency_key` real and PUBLIC in Flue? (A prior report flagged it as documented in the
      channels guide but ABSENT from the agent-api reference — confirm or refute.)
    - Does the "one store per session" claim hold for Flue on Node, or only on Cloudflare?
F3. "at-least-once execution over exactly-once recording" — is that verbatim from Flue's durability
    guide? Quote it exactly. If the document has altered the wording, say how.
F4. "admit durably before any model work" and "exactly one terminal outcome per submission" — verify
    both verbatim against guide/durability.
F5. "An interrupted side effect is surfaced as unknown, never silently retried." Verify against Flue's
    tool-batch repair rules. Is this true for ALL tools, or only ordinary (non-durable) ones? The
    document states it without qualification — is that an overstatement?
F6. "Of eleven frameworks, only two ship a tenancy model — Mastra and LangGraph Platform — and both
    paywall it." Verify the count of eleven, and verify BOTH tenancy claims against Mastra's and
    LangGraph's own documentation. Is "paywalled" accurate for each? Is any OTHER framework in the set
    a counterexample the document missed?
F7. The pause/approval semantics attributed to the field: "stale answers never authorize the original
    call". Which framework is that from, and is the document's generalisation of it fair?
F8. Anything else in the document sourced from Flue or the survey that is WRONG or overstated.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/v2-flue-review.md
Format: a table of claim | verdict (CONFIRMED / WRONG / OVERSTATED / UNVERIFIABLE) | exact quote from
the primary source | correction. Then "most serious problems", worst first.
Where the document is right, say so in one line and move on. Where it is wrong, be specific and give
the replacement wording. No preamble. 300-700 lines.
