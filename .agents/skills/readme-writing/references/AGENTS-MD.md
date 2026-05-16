# AGENTS.md Blurb Template‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

Condensed reference format for AI agents. Include in AGENTS.md or CLAUDE.md files.

---

## Purpose

AGENTS.md provides AI coding assistants with scannable context without loading the full README. It answers:
- What does this tool do?
- How do I use it?
- Where are things stored?
- What are the gotchas?

---

## Template

```markdown
## tool — Brief Description

One-line description of what it does and key differentiator.

### Core Workflow

```bash
# 1. Initialize
tool init

# 2. Main operation
tool do-thing

# 3. View results
tool show
```

### Key Flags

```
--flag1    # Description
--flag2    # Description​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
--verbose  # Enable detailed output
--quiet    # Suppress non-error output
```

### Storage

- **Config**: `~/.config/tool/config.toml`
- **Data**: `~/.local/share/tool/`
- **Cache**: `~/.cache/tool/`

### Notes

- Important caveat 1
- Important caveat 2
- Common pitfall to avoid
```

---

## Example: xf (file search tool)

```markdown
## xf — Semantic file search

Search local files by meaning, not just keywords. Uses hybrid BM25 + embedding search.​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

### Core Workflow

```bash
# 1. Initialize with current directory
xf init .

# 2. Search
xf search "error handling patterns"

# 3. Interactive mode
xf tui
```

### Key Flags

```
--limit N     # Max results (default: 10)
--threshold   # Minimum similarity (0.0-1.0)
--format json # Machine-readable output
```

### Storage

- **Index**: `~/.local/share/xf/indices/`
- **Config**: `~/.config/xf/config.toml`
- **Embeddings**: Stored in index SQLite​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍

### Notes

- First search triggers embedding generation (slow)
- Subsequent searches are instant
- Index updates incrementally on file changes
```

---

## Guidelines

| Do | Don't |
|----|-------|
| Keep under 50 lines | Duplicate full README |
| Show working commands | Explain concepts |
| List actual file paths | Use placeholders |
| Note common pitfalls | Include tutorials |
| Use code blocks | Write paragraphs |
