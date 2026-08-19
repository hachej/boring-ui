# Harvest prompt template

> Substitute {{TARGET}}, {{LAST_VERSION}}, {{CURRENT_VERSION}}, and inject `state/exclusions.md` verbatim.

---

Harvest what changed in **{{TARGET}}** between **{{LAST_VERSION}}** and **{{CURRENT_VERSION}}**.

{{EXCLUSIONS}}

Sources and how to read them: {{SOURCES}}. Prefer source over docs where they disagree, and **report the
disagreement** — docs/source skew is itself a finding.

Report only:
1. Mechanisms that are new or changed since {{LAST_VERSION}}.
2. Anything contradicting an established item above, with better evidence.
3. Numbers behind any claim of improvement. A superlative without a number is not a finding.

For each: the mechanism, why it works, what it would cost us, and which of our ratified decisions
(D25–D31, static fleet, default-deny grants, authored-data-not-code) it would violate. **Label violations
plainly** — an idea we cannot adopt is still worth knowing.

Record every claim as a row in the findings table (REPORT-TEMPLATE.md), `conf: reported`. List anything you could not open under "Not run". **A clean negative is a good result**: "nothing novel since
{{LAST_VERSION}}" is a complete and acceptable report.

Output to `runs/{{RUN}}/harvest.md` using REPORT-TEMPLATE.md. No preamble.
