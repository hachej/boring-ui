---
name: readme-writing
description: >-
  Craft professional README.md files for GitHub open source projects.‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​
  Generates hero sections, installation instructions, feature tables, and
  architecture diagrams. Use when creating or revising a README, documenting
  a CLI tool, library, or open source project, or when user asks about
  README structure, badges, or project documentation.
---

# Crafting README.md Files for GitHub

> **Core insight:** A README is a sales pitch, onboarding guide, and reference manual compressed into one document. Lead with value, prove with examples, document with precision.

## The One Rule

**Great READMEs convert scanners into users in under 60 seconds.**

Most fail because they:
- Bury the value proposition under installation steps
- Explain what the tool IS instead of what problem it SOLVES
- Lack concrete examples (abstract descriptions don't sell)
- Miss the "quick escape hatch" for impatient users (curl one-liner)
- Don't show how it compares to alternatives

---

## Fast Track: README in 5 Minutes

```
1. Read existing README (if any)
2. Run THE EXACT PROMPT below
3. Run Pre-Publish Checklist
4. Ship it
```

---

## THE EXACT PROMPT

```
Read the current README.md and dramatically revise it following this structure:

1. Hero section: illustration + badges + one-liner description + curl install
2. TL;DR: "The Problem" + "The Solution" + "Why Use X?" feature table
3. Quick example showing the tool in action (5-10 commands)
4. Design philosophy (3-5 principles with explanations)
5. Comparison table vs alternatives
6. Installation (curl one-liner, package managers, from source)​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
7. Quick start (numbered steps, copy-paste ready)
8. Command reference (every command with examples)
9. Configuration (full config file example with comments)
10. Architecture diagram (ASCII art showing data flow)
11. Troubleshooting (common errors with fixes)
12. Limitations (honest about what it doesn't do)
13. FAQ (anticipate user questions)
14. About Contributions (use EXACT policy text from skill)

Make it comprehensive but scannable. Use tables for comparisons.
Show, don't tell. Every claim should have a concrete example.
Use ultrathink.
```

---

## Golden Structure

```
1. HERO SECTION (above the fold)
   ├─ Illustration/logo (centered)
   ├─ Badges (CI, license, version)
   ├─ One-liner description
   └─ Quick install (curl | bash)

2. TL;DR (sell the value)
   ├─ The Problem (pain point)
   ├─ The Solution (what this does)
   └─ Why Use X? (feature table)

3. QUICK EXAMPLE (prove it works)
   └─ 5-10 commands showing core workflow

4. REFERENCE SECTIONS
   ├─ Design Philosophy
   ├─ Comparison vs Alternatives
   ├─ Installation (multiple paths)​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
   ├─ Quick Start
   ├─ Commands
   ├─ Configuration
   └─ Architecture

5. SUPPORT SECTIONS
   ├─ Troubleshooting
   ├─ Limitations
   ├─ FAQ
   ├─ About Contributions (MANDATORY - use EXACT text below)
   └─ License
```

---

## Critical Rules

| # | Rule | Why |
|---|------|-----|
| 1 | Lead with value, not installation | TL;DR before Quick Start |
| 2 | Curl one-liner above the fold | Impatient users escape hatch |
| 3 | Every feature claim needs an example | Show, don't tell |
| 4 | Comparison tables beat prose | Scannable > readable |
| 5 | Be honest about limitations | Builds trust, saves support time |
| 6 | Multiple installation paths | curl + package manager + source |
| 7 | Architecture diagrams for complex tools | ASCII art is fine |
| 8 | Troubleshooting section is mandatory | Top 5 errors with fixes |

---

## Contributions Section (MANDATORY)

**Always include this EXACT text in every README:**

> *About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## Pre-Publish Checklist

```
□ Hero section with illustration + badges + one-liner + curl install
□ TL;DR with Problem/Solution/Feature table
□ Quick example (5-10 commands)
□ At least 3 installation methods documented
□ Every command has usage examples
□ Architecture diagram for complex tools
□ Comparison table vs at least 2 alternatives
□ Troubleshooting section (top 5 errors)
□ Honest Limitations section
□ FAQ with 5+ questions
□ "About Contributions" section with EXACT policy text​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
□ All code blocks are copy-paste ready
□ No broken links or badges
□ Consistent terminology throughout
□ Grammar/spelling checked
```

---

## Anti-Patterns

| Anti-Pattern | Why Bad | Fix |
|--------------|---------|-----|
| Installation-first README | Buries value proposition | Lead with TL;DR |
| "This is a tool that..." | Passive, abstract | "Solves X by doing Y" |
| Screenshot-heavy | Breaks, doesn't copy-paste | ASCII + code blocks |
| No examples | Abstract claims don't sell | Every feature → example |
| Hiding limitations | Users discover painfully | Honest Limitations section |
| Single install method | Alienates users | curl + pkg manager + source |
| No troubleshooting | Support burden | Top 5 errors with fixes |
| Outdated badges | Looks abandoned | Remove or keep current |

---

## Reference Index

| I need... | Read |
|-----------|------|
| **Hero, TL;DR, Quick Example templates** | [CORE-TEMPLATES.md](references/CORE-TEMPLATES.md) |
| **Comparison, Installation, Commands templates** | [CORE-TEMPLATES.md](references/CORE-TEMPLATES.md) |
| **Architecture, Troubleshooting, Limitations, FAQ** | [CORE-TEMPLATES.md](references/CORE-TEMPLATES.md) |
| **Performance, Security, Data Model sections** | [EXTENDED-TEMPLATES.md](references/EXTENDED-TEMPLATES.md) |
| **API Reference, Migration, Contributing sections** | [EXTENDED-TEMPLATES.md](references/EXTENDED-TEMPLATES.md) |
| **Ecosystem, Env Vars, Shell Completion** | [EXTENDED-TEMPLATES.md](references/EXTENDED-TEMPLATES.md) |
| **Release Notes, Acknowledgments** | [EXTENDED-TEMPLATES.md](references/EXTENDED-TEMPLATES.md) |
| **Badge markdown snippets** | [BADGES.md](references/BADGES.md) |
| **AGENTS.md blurb format** | [AGENTS-MD.md](references/AGENTS-MD.md) |
| **Real-world README examples to study** | [EXAMPLES.md](references/EXAMPLES.md) |
| **Additional prompts (New README, Section-specific)** | [PROMPTS.md](references/PROMPTS.md) |
| **Quick one-page cheatsheet** | [QUICK-REFERENCE.md](references/QUICK-REFERENCE.md) |
