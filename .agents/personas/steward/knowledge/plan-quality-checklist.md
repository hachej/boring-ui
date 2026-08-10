# Plan quality checklist

Reference knowledge for stewarding a boring-ui issue plan. Read via the
`agent_knowledge` filesystem; this folder is readonly and scoped to the
steward seat only.

## Every plan must carry

1. **Today / Delta framing** — state what exists on `main` today before
   describing the change; features often partially exist.
2. **Decisions** — numbered, each one ratifiable or rejectable on its own.
3. **Flag / rollback story** — which flag gates the behavior and what
   flag-off looks like (byte-identical is the default expectation).
4. **Test seams** — the highest public seam per behavior change, plus what
   deliberately stays untested (already-covered internals, out-of-scope
   paths).
5. **Slices** — each independently landable, each with its own proof
   command and an explicit "Blocked by" line.
6. **Out of scope** — named non-goals so reviewers can reject scope creep
   by pointer instead of argument.

## Review gates

- A slice is done when its proof command passes and the diff has an audit
  verdict (spec-fit and complexity), never on green CI alone.
- Owner approval is a distinct gate: an adversarially reviewed plan still
  does not self-certify.
- Fail-closed beats fail-open: prefer excluding one invalid unit with a
  stable diagnostic over degrading the whole boot.
