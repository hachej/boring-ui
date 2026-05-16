# Core Section Templates‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

Copy-paste templates for standard README sections.

---

## Hero Section

```markdown
# tool-name

<div align="center">
  <img src="illustration.webp" alt="tool-name - One-line description">
</div>

<div align="center">

[![CI](https://github.com/user/repo/actions/workflows/ci.yml/badge.svg)](https://github.com/user/repo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

One-sentence description of what this tool does and its key differentiator.

<div align="center">
<h3>Quick Install</h3>

```bash
curl -fsSL https://raw.githubusercontent.com/user/repo/main/install.sh | bash
```

**Or build from source:**

```bash
cargo install --git https://github.com/user/repo.git
```

</div>
```

---

## TL;DR Section

```markdown
## TL;DR

**The Problem**: [Specific pain point in 1-2 sentences. Be concrete.]

**The Solution**: [What this tool does to solve it. Action-oriented.]

### Why Use tool-name?

| Feature | What It Does |
|---------|--------------|
| **Feature 1** | Concrete benefit, not abstract capability |
| **Feature 2** | Another specific value proposition |
| **Feature 3** | Quantify when possible (e.g., "<10ms search") |
```

---

## Quick Example

```markdown
### Quick Example

```bash
# Initialize (one-time setup)
$ tool init

# Core operation
$ tool do-thing --flag value

# See results
$ tool show results

# The killer feature
$ tool magic --auto
```
```

---

## Comparison Table

```markdown
## How tool-name Compares

| Feature | tool-name | Alternative A | Alternative B | Manual |​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
|---------|-----------|---------------|---------------|--------|
| Feature 1 | ✅ Full support | ⚠️ Partial | ❌ None | ❌ |
| Feature 2 | ✅ <10ms | 🐢 ~500ms | ✅ Fast | N/A |
| Setup time | ✅ ~10 seconds | ❌ Hours | ⚠️ Minutes | ❌ |

**When to use tool-name:**
- Bullet point of ideal use case
- Another use case

**When tool-name might not be ideal:**
- Honest limitation
- Another case where alternatives win
```

---

## Installation Section

```markdown
## Installation

### Quick Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/user/repo/main/install.sh | bash
```

**With options:**

```bash
# Auto-update PATH
curl -fsSL https://... | bash -s -- --easy-mode

# Specific version
curl -fsSL https://... | bash -s -- --version v1.0.0

# System-wide (requires sudo)
curl -fsSL https://... | sudo bash -s -- --system
```

### Package Managers

```bash
# macOS/Linux (Homebrew)
brew install user/tap/tool

# Windows (Scoop)
scoop bucket add user https://github.com/user/scoop-bucket
scoop install tool
```

### From Source

```bash
git clone https://github.com/user/repo.git
cd repo
cargo build --release
cp target/release/tool ~/.local/bin/​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
```
```

---

## Command Reference Pattern

```markdown
## Commands

Global flags available on all commands:

```bash
--verbose       # Increase logging
--quiet         # Suppress non-error output
--format json   # Machine-readable output
```

### `tool command`

Brief description of what this command does.

```bash
tool command                    # Basic usage
tool command --flag value       # With options
tool command --help             # See all options
```
```

---

## Architecture Diagram

```markdown
## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Input Layer                              │
│   (files, API calls, user commands)                             │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Processing Layer                            │
│   Component A → Component B → Component C                        │
└─────────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
│ Storage A        │ │ Storage B        │ │ Output           │
│ - Detail 1       │ │ - Detail 1       │ │ - Format 1       │
│ - Detail 2       │ │ - Detail 2       │ │ - Format 2       │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```
```

---

## Troubleshooting Pattern

```markdown
## Troubleshooting

### "Error message here"

```bash
# Solution
command to fix it
```

### "Another common error"

Explanation of why this happens and how to fix it.

```bash
# Check the state
diagnostic command

# Fix it
fix command
```
```

---

## Limitations Section

```markdown
## Limitations

### What tool-name Doesn't Do (Yet)

- **Limitation 1**: Brief explanation, workaround if any
- **Limitation 2**: Why this is out of scope

### Known Limitations

| Capability | Current State | Planned |
|------------|---------------|---------|
| Feature X | ❌ Not supported | v2.0 |
| Feature Y | ⚠️ Partial | Improving |
```

---

## FAQ Pattern

```markdown
## FAQ

### Why "tool-name"?

Brief etymology or meaning.

### Is my data safe?

Yes/No with explanation. Privacy guarantees.

### Does it work with X?

Compatibility information.

### How do I [common task]?

```bash
# Command to accomplish it
tool do-thing
```
```
