# Gemini 3.1 Pro — Final Bead Review

## Key Takeaways

### Beads to DROP
- **06** (Sidebar spacing) — absorbed by 17
- **10** (Tab sizing) — absorbed by 17
- **12** (Dead code) — just `rm` the file, not a task
- **13** (Auth consistency) — defer until core IDE is polished

### Beads to MERGE
- **04 + 07 + 09 + 16** -> "Interactive Elements Foundation" (buttons, hovers, focus rings, icons in one PR)
- **01 + 01b + 08** -> "Chat Input & Message Polish" (textarea, placeholders, message bubbles in one PR)

### Bead 17 to SPLIT
- **17a:** Layout Flattening (sidebar reduction, header merging)
- **17b:** Progressive Disclosure (hover states, hiding redundant buttons) — depends on hover/icon system being ready

### Missing Beads Identified
- Custom scrollbar styling (especially for Windows/dark mode)
- Tooltip system (needed before hiding controls behind hover-only)
- Toast / global error notification system
- AI typing/streaming indicator polish

### Risk Flags
- Bead 00: streaming XML parsing can crash chat — needs error boundaries
- Bead 17: moving bot icon to tab strip — what if all tabs closed? Need fallback
- Hiding buttons: DON'T hide until keyboard/context-menu alternatives exist

### Recommended Execution Phases

**Phase 1 — "It's Broken" (parallel)**
- Bead 00 (agent tool rendering)
- Bead 03 (dark mode contrast)

**Phase 2 — Foundations (parallel)**
- Bead 17a (layout flattening)
- Merged 04+07+09+16 (interactive elements foundation)

**Phase 3 — Core UX**
- Merged 01+01b+08 (chat UX polish)
- Bead 17b (progressive disclosure)
- Bead 02 (user menu)

**Phase 4 — Peripheral Polish**
- Bead 14 (settings)
- Bead 15 (modal)
- Bead 05 (empty states)
- Bead 11 (panel resizers) + scrollbar styling
