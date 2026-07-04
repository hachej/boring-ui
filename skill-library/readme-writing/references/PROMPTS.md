# README Prompts

Copy-paste prompts for various README scenarios.‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

---

## De-Slopify Prompt (Quick Polish)

For existing READMEs that need cleanup without full restructuring:

```
I want you to read through the complete README file and remove all AI-ish or inauthentic
sounding language, excessive use of exclamation marks, or marketing-speak. Replace with
direct, technical, professional prose. Keep the structure but make every sentence sound
like it was written by a senior engineer who values clarity over enthusiasm.

Specific targets:
- Remove: "Awesome!", "Amazing!", "Powerful!", "Revolutionary!"
- Remove: Unnecessary intensifiers ("very", "really", "incredibly")
- Remove: Marketing fluff ("seamless", "cutting-edge", "next-generation")
- Keep: Technical accuracy, concrete examples, specific claims with evidence
```

---

## THE EXACT PROMPT — Full README Revision

The primary prompt. Use this for comprehensive README rewrites.

```
Read the current README.md and dramatically revise it following this structure:

1. Hero section: illustration + badges + one-liner description + curl install
2. TL;DR: "The Problem" + "The Solution" + "Why Use X?" feature table
3. Quick example showing the tool in action (5-10 commands)
4. Design philosophy (3-5 principles with explanations)
5. Comparison table vs alternatives
6. Installation (curl one-liner, package managers, from source)
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

## New README from Scratch

For projects without an existing README.

```
Create a comprehensive README.md for this project following this structure:

1. Analyze the codebase to understand:
   - What problem this solves
   - Key features and capabilities
   - Installation requirements
   - Basic usage patterns

2. Write the README with these sections:
   - Hero: illustration placeholder + badges + one-liner + curl install
   - TL;DR: Problem/Solution/Feature table
   - Quick Example: 5-10 commands demonstrating core workflow
   - Design Philosophy: 3-5 guiding principles​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
   - Comparison: table vs 2+ alternatives (research if needed)
   - Installation: curl, package managers, from source
   - Quick Start: numbered steps
   - Commands: every command with examples
   - Configuration: full example config with comments
   - Architecture: ASCII diagram of data flow
   - Troubleshooting: anticipate 5 common errors
   - Limitations: honest about what it doesn't do
   - FAQ: 5+ anticipated questions
   - About Contributions: [use EXACT policy text from skill]

Show, don't tell. Every claim needs a concrete example.
```

---

## Section-Specific Prompts

### Hero Section Only

```
Create a hero section for the README with:
- Centered illustration placeholder (webp format)
- CI badge, license badge, version badge
- One-sentence description (what it does + key differentiator)
- Quick install: curl one-liner + cargo install alternative

Keep it above-the-fold scannable.
```

### TL;DR Section Only

```
Write a TL;DR section with:
- "The Problem": specific pain point in 1-2 sentences
- "The Solution": what this tool does (action-oriented)
- "Why Use X?" feature table with 4-6 concrete benefits

Be specific. Avoid abstract descriptions.
```

### Comparison Table Only

```
Create a comparison table for this tool vs alternatives:
- Research 2-3 main alternatives
- Compare on 5-7 relevant features
- Use ✅/⚠️/❌ symbols for scannability
- Include "When to use X" and "When X might not be ideal" sections
- Be fair — acknowledge where alternatives win
```

### Installation Section Only

```
Write a comprehensive installation section with:

1. Quick Install (curl one-liner with options)
   - Basic: curl ... | bash
   - With options: --easy-mode, --version, --system

2. Package Managers
   - Homebrew (macOS/Linux)
   - Scoop (Windows)
   - apt/dnf if applicable

3. From Source
   - git clone
   - cargo build --release
   - copy to PATH

Make every command copy-paste ready.
```

### Command Reference Only​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

```
Document all commands with this pattern:

1. List global flags first
2. For each command:
   - Brief description (one line)
   - Basic usage example
   - With-options example
   - --help reminder

Format for scannability. Every command needs a working example.
```

### Architecture Diagram Only

```
Create an ASCII architecture diagram showing:
- Input layer (what goes in)
- Processing layer (what happens)
- Storage/output layer (what comes out)

Use box-drawing characters (┌ ─ ┐ │ └ ┘ ├ ┤ ┬ ┴ ┼).
Include arrows showing data flow.
Add brief labels inside boxes.
```

### Troubleshooting Section Only

```
Create a troubleshooting section with the top 5 most likely errors:

For each error:
1. Exact error message as heading
2. Why this happens (one sentence)
3. Fix command(s)

Anticipate: installation issues, permission errors, config problems,
common misuse patterns, platform-specific issues.
```

### FAQ Section Only

```
Write an FAQ section with 5-8 questions covering:
- Etymology/naming ("Why 'tool-name'?")
- Privacy/security ("Is my data safe?")
- Compatibility ("Does it work with X?")
- Common tasks ("How do I...?")
- Troubleshooting ("Why does X happen?")
- Alternatives ("How does this compare to Y?")

Each answer should be 1-3 sentences. Include code blocks where helpful.
```

---

## Audit/Improve Prompts

### README Audit

```
Audit this README against these criteria:

□ Hero section with illustration + badges + one-liner + curl install
□ TL;DR with Problem/Solution/Feature table
□ Quick example (5-10 commands)
□ At least 3 installation methods
□ Every command has usage examples
□ Architecture diagram (for complex tools)
□ Comparison table vs alternatives
□ Troubleshooting section (top 5 errors)
□ Honest Limitations section
□ FAQ with 5+ questions
□ About Contributions section
□ All code blocks copy-paste ready​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
□ No broken links or badges

Report what's missing and provide specific improvements.
```

### Scannability Improvement

```
Improve the scannability of this README:

1. Replace prose with tables where possible
2. Add bold section labels
3. Ensure code blocks are properly formatted
4. Add visual hierarchy with consistent heading levels
5. Remove redundant explanations
6. Front-load important information in each section

Show before/after for each change.
```

### Example Enhancement

```
Enhance this README with better examples:

1. Identify every feature claim without a concrete example
2. Add working code/command examples for each
3. Ensure examples are copy-paste ready
4. Add expected output where helpful
5. Progress from simple to advanced

Show, don't tell.
```

---

## Special Case Prompts

### Library/API README

```
Adapt the README for a library (not CLI tool):

Replace CLI-focused sections with:
- API Quick Start (basic usage code)
- Installation (cargo add / npm install / pip install)
- API Reference (types, methods, error handling)
- Integration examples with popular frameworks
- Versioning/compatibility notes
```

### Monorepo README

```
Create a README for a monorepo with multiple packages:

- Overview of what the monorepo contains
- Package matrix (name, description, status)
- Quick navigation to each package's README
- Shared development setup
- Cross-package workflows
- Contribution guidelines (if accepting)
```

### Migration Guide README

```
Add a migration/upgrade section:

1. List breaking changes between versions
2. Provide step-by-step migration commands
3. Include before/after config examples
4. Add verification commands
5. Document rollback procedure
```
