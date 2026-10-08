// Fictional files the scenarios put in the workspace (relative paths). Text stays text; media is generated in code.
import { ORBIT_SVG, briefPdf, moonBadgePng } from './media.mjs';

export const CONSULTATION = `# Consultation notes (fictional)

Patient: Mx. Avery Example, 47, fictional identifier EX-0001.
Reason: three weeks of knee pain after a hiking trip to the fictional Mount Placeholder.
Findings: mild swelling of the right knee, full range of motion, no instability.
Plan: refer to physiotherapy for a strengthening programme; review in six weeks.
`;

/** The notes the writing and delegation scenarios read. */
export const NOTES = { 'notes/consultation.md': CONSULTATION };

/** Files for the viewers: Markdown that rich editing keeps exactly, Markdown it cannot, HTML, an image, an SVG and a PDF. */
export const VIEWER_FILES = {
  'docs/picnic-plan.md': `# Moon picnic plan

A **fictional** plan for an invented evening. See the [tide table](tide-times.html) first.

| Item     | Quantity |
| -------- | -------- |
| Blankets | 2        |
| Thermos  | 1        |

|Tide|Time|Height|
|:--|:-:|--:|
|Low|\`19:40\`|*0.4 m*|
|High||[pier \\| sign](tide-times.html)|

![Moon badge](../media/moon-badge.png)

- [x] Pick the pier
- [ ] Pack the star map
`,
  'docs/legacy-notes.md': `---
title: Legacy notes
---

# Legacy notes

<div class="aside">Raw HTML kept as written.</div>

A claim with a footnote.[^1]

[^1]: The footnote is invented too.
`,
  'docs/tide-times.html': '<h1>Fictional tide times</h1>\n<p>High tide at the placeholder pier.</p>\n<table><tr><th>Day</th><th>High</th></tr><tr><td>Monday</td><td>06:12</td></tr><tr><td>Tuesday</td><td>06:58</td></tr></table>\n',
  'media/moon-badge.png': moonBadgePng(),
  'media/orbit.svg': ORBIT_SVG,
  'media/moon-brief.pdf': briefPdf(),
};

/** A small repository's worth of files for the git scenarios. */
export const CLUB_FILES = {
  'README.md': '# Tidewater Walking Club (fictional)\n\nPlanning notes for an invented coastal walking club. Everything here is demo content.\n',
  'trips/itinerary.md': '# Spring walk itinerary (fictional)\n\n1. Meet at Placeholder Pier at 09:00.\n2. Follow the cliff path to Example Cove.\n3. Lunch at the Invented Inn.\n',
  'packing-list.md': '# Packing list (fictional)\n\n- Waterproof jacket\n- Walking boots\n- Flask of tea\n',
};
