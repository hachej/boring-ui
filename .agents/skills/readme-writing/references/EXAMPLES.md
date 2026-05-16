# Real-World README Examples‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

Study these READMEs for patterns and inspiration.

---

## Exemplary READMEs by Pattern

| Project | Notable Pattern | Why It Works |
|---------|-----------------|--------------|
| [xf](https://github.com/Dicklesworthstone/xf) | Comprehensive CLI docs, search deep-dives | Exhaustive yet scannable |
| [ripgrep](https://github.com/BurntSushi/ripgrep) | Benchmarks, comparison tables | Data-driven claims |
| [bat](https://github.com/sharkdp/bat) | GIF demos, feature highlights | Visual proof |
| [exa](https://github.com/ogham/exa) | Screenshot galleries, color themes | Shows personality |
| [starship](https://github.com/starship/starship) | Preset configurations, installation matrix | Multiple entry points |
| [jq](https://github.com/jqlang/jq) | Tutorial progression, manual links | Learning path |
| [fzf](https://github.com/junegunn/fzf) | Integration examples, key bindings | Ecosystem integration |
| [fd](https://github.com/sharkdp/fd) | Benchmark tables, vs find comparison | Proves value with data |

---

## Pattern Deep-Dives

### Benchmark Tables (ripgrep style)

```markdown
## Benchmarks

| Pattern | ripgrep | grep | ag | git grep |
|---------|---------|------|----|----------|
| Simple literal | 0.1s | 1.2s | 0.3s | 0.8s |
| Complex regex | 0.4s | 12.3s | 2.1s | 5.6s |​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
| Large files | 0.2s | 8.7s | 1.5s | 3.2s |

*Tested on Linux kernel source tree (~1.5GB)*
```

### GIF Demos (bat style)

```markdown
## Features

### Syntax Highlighting

![Syntax highlighting demo](assets/syntax-demo.gif)

### Git Integration

![Git integration demo](assets/git-demo.gif)
```

### Installation Matrix (starship style)

```markdown
## Installation

| Platform | Method | Command |
|----------|--------|---------|
| macOS | Homebrew | `brew install tool` |
| Linux | apt | `sudo apt install tool` |
| Linux | snap | `snap install tool` |
| Windows | scoop | `scoop install tool` |
| Windows | winget | `winget install tool` |
| Any | cargo | `cargo install tool` |
| Any | npm | `npm install -g tool` |
```

---

## Progressive Disclosure for Long READMEs

For READMEs exceeding 1000 lines, use collapsible sections:​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

```markdown
<details>
<summary><strong>Advanced Configuration</strong></summary>

Content that most users don't need on first read...

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TOOL_DEBUG` | Enable debug mode | `false` |

### Custom Plugins

```toml
[plugins]
enabled = ["plugin-a", "plugin-b"]
```

</details>
```

---

## Separate Documentation Strategy

When README exceeds 2000 lines, split into docs:

```markdown
## Documentation

| Topic | Link |
|-------|------|
| Installation | [docs/installation.md](docs/installation.md) |
| Configuration | [docs/configuration.md](docs/configuration.md) |
| API Reference | [docs/api.md](docs/api.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |

Keep the README itself focused on the 80% use case.
```

---

## What to Study in Each README

### ripgrep
- How benchmarks are presented (methodology disclosed)
- Comparison table structure (fair, includes weaknesses)​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
- Installation section (exhaustive yet organized)

### bat
- GIF placement (early, proving core value)
- Theme gallery (visual proof of customization)
- Integration section (works with other tools)

### starship
- Preset system (reduces cognitive load)
- Cross-platform installation matrix
- Configuration examples (immediate value)

### fzf
- Integration recipes (shell, vim, tmux)
- Key bindings reference (scannable)
- Advanced examples (power user path)

---

## Anti-Pattern Examples

| README Pattern | Problem | Better Approach |
|----------------|---------|-----------------|
| Wall of text intro | Users bounce | TL;DR + feature table |
| "Work in progress" badge | Signals abandonment | Remove or be specific |
| Outdated screenshots | Looks unmaintained | ASCII diagrams or remove |
| Extensive history section | Irrelevant to users | Move to wiki/blog |
| Copy of man page | Not scannable | Reorganize by task |
