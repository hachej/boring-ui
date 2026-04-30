# Using `uv` for Python SDK Distribution

## What is `uv`?

[`uv`](https://github.com/astral-sh/uv) is a **blazing-fast Python package manager** written in Rust. It's 10-100x faster than pip and provides:

- **Package installation** (like pip)
- **Python version management** (like pyenv)
- **Virtual environment management** (like venv)
- **Lock files** (like npm/pnpm/yarn)
- **Project management** (like Poetry)

## Why `uv` is Perfect for This Use Case

| Concern | Traditional pip | With `uv` |
|---------|----------------|-----------|
| **Install speed** | 30-60 seconds | 1-3 seconds |
| **Lock file** | `requirements.txt` (no locking) | `uv.lock` (exact versions) |
| **Python version** | Manual install + venv | `uv python install 3.12` |
| **Reproducibility** | Weak | Strong (lock file) |
| **Workspace support** | No | Yes (monorepo-friendly) |
| **NPM-like workflow** | No | Yes (`uv add`, `uv sync`) |

---

## Recommended Architecture: `uv` + NPM Hybrid

### Concept

Use `uv` for **Python SDK management** inside the workspace, while keeping **NPM for JS/tooling**. This gives you:

- Fast Python installs (uv)
- Reproducible environments (lock files)
- Python version management (uv)
- Single workspace package.json (NPM)

### Directory Structure

```
workspace-template/
├── package.json              # NPM dependencies
├── uv.toml                   # uv configuration
├── pyproject.toml            # Python project config
├── uv.lock                   # Locked Python dependencies
├── .venv/                    # Virtual environment (gitignored)
└── transforms/
    └── custom/
```

---

## Implementation Guide

### Step 1: Install `uv` in Sandboxes

**Option A: Global install (recommended for dev sandboxes)**

```bash
# In sandbox bootstrap script or Dockerfile
curl -LsSf https://astral.sh/uv/install.sh | sh
# Adds to ~/.local/bin/uv
```

**Option B: Download binary directly**

```bash
# For vercel-sandbox or minimal containers
curl -LsSf https://astral.sh/uv/0.5.0/install.sh | sh
# Or download pre-built binary:
curl -L https://astral.sh/uv/0.5.0/x86_64-unknown-linux-gnu/uv.tar.gz | tar xz
```

**Dockerfile example:**

```dockerfile
FROM ubuntu:22.04

# Install system deps
RUN apt-get update && apt-get install -y \
    curl \
    build-essential

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Add to PATH
ENV PATH="/root/.local/bin:$PATH"

# Verify
RUN uv --version
```

---

### Step 2: Create Python Project with `uv`

**Initialize Python project:**

```bash
cd workspace-template

# Initialize uv project
uv init --name macro-workspace

# This creates:
# - pyproject.toml
# - uv.lock
# - .venv/ (virtual environment)
# - src/ or your code directory
```

**pyproject.toml:**

```toml
[project]
name = "macro-workspace"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    "pandas>=2.0.0",
    "clickhouse-connect>=0.7.0",
]

[project.scripts]
# Expose CLI entry point
bm = "boring_macro._cli:main"
```

**uv.toml (optional, for workspace config):**

```toml
[python]
# Use specific Python version
version = "3.12"

[venv]
# Where to create virtual environment
path = ".venv"
```

---

### Step 3: Add SDK Dependencies

```bash
# Add SDK as dependency
uv add boring-macro-sdk

# Or from git
uv add git+https://github.com/yourorg/boring-macro-sdk.git

# Or from local path
uv add /path/to/boring-macro-sdk
```

This updates:
- `pyproject.toml` (adds dependency)
- `uv.lock` (locks exact versions)

---

### Step 4: Install SDK in Workspace

**Workspace bootstrap script:**

```bash
#!/bin/bash
# bootstrap.sh

# Install uv if not present
if ! command -v uv &> /dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
fi

# Sync Python dependencies
uv sync

# Activate virtual environment
source .venv/bin/activate

# Verify CLI is available
bm --version
```

**In workspace-template:**

```bash
# package.json
{
  "scripts": {
    "postinstall": "./bootstrap.sh"
  }
}
```

---

### Step 5: Expose CLI to Agent

**Option A: Virtual environment bin in PATH**

```bash
# Add to workspace .bashrc or sandbox PATH
export PATH="$PWD/.venv/bin:$PATH"
```

Now agent can run:
```bash
bm run --tool custom:ma12 --input series1 --output derived1
```

**Option B: NPM wrapper (for NPM-only sandboxes)**

```javascript
// bin/bm.js
#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { join } from 'node:path';

// Use uv's virtual environment Python
const venvPython = join(process.cwd(), '.venv', 'bin', 'python');
const args = ['scripts/bm-wrapper.py', ...process.argv.slice(2)];

spawn(venvPython, args, { stdio: 'inherit' })
  .on('exit', code => process.exit(code));
```

---

## Complete Example: workspace-template

### package.json

```json
{
  "name": "macro-workspace",
  "version": "1.0.0",
  "scripts": {
    "postinstall": "./setup-python.sh"
  }
}
```

### setup-python.sh

```bash
#!/bin/bash
set -e

echo "Setting up Python environment..."

# Install uv if not present
if ! command -v uv &> /dev/null; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

# Sync Python dependencies
echo "Syncing Python dependencies..."
uv sync

# Ensure CLI is in PATH
echo "export PATH=\"\$PWD/.venv/bin:\$PATH\"" >> ~/.bashrc

echo "Python environment ready. Run 'bm list' to see transforms."
```

### pyproject.toml

```toml
[project]
name = "macro-workspace"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    "pandas>=2.0.0",
    "clickhouse-connect>=0.7.0",
    "boring-macro-sdk>=0.2.0",
]

[project.scripts]
bm = "boring_macro._cli:main"

[tool.uv]
# Pin Python version
python-version = "3.12"
```

### uv.toml

```toml
[python]
version = "3.12"

[venv]
path = ".venv"

[resolution]
# Prefer pre-release packages if needed
prerelease = "if-necessary-or-explicit"
```

---

## Using `uv` in Agent Sandboxes

### Sandbox Mode: `direct` (macOS/Windows dev)

```bash
# Developer has uv installed globally
# Workspace bootstrap runs:
uv sync
source .venv/bin/activate
bm list  # Works!
```

### Sandbox Mode: `local` (bwrap on Linux)

```dockerfile
# Base image with uv
FROM ubuntu:22.04
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"
```

```bash
# In bwrap sandbox
uv sync
export PATH="$PWD/.venv/bin:$PATH"
bm run --tool custom:ma12 ...
```

### Sandbox Mode: `vercel-sandbox` (Firecracker)

```bash
# Custom runtime image with uv + Python
FROM vercel/sandbox-base:latest
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Workspace bootstrap
uv sync --frozen  # Use locked versions
export PATH="$PWD/.venv/bin:$PATH"
```

---

## Benefits of `uv` for This Use Case

### 1. **Speed**

```bash
# pip install
$ time pip install -r requirements.txt
# 45 seconds

# uv sync
$ time uv sync
# 2 seconds
```

### 2. **Reproducibility**

```toml
# uv.lock (exact versions)
[[package]]
name = "pandas"
version = "2.2.0"
source = { registry = "https://pypi.org/simple" }
sdist = { url = "...", hash = "sha256:abc123" }
dependencies = [
    { name = "numpy", specifier = ">=1.26.0" },
]
```

Every workspace gets **identical** dependencies.

### 3. **Python Version Management**

```bash
# Install specific Python version
uv python install 3.12

# Use it for workspace
uv sync --python 3.12
```

No more "Python not found" errors in sandboxes.

### 4. **Workspace/Monorepo Support**

```toml
# pyproject.toml
[tool.uv.workspace]
members = ["packages/*"]

# Can install multiple local SDKs at once
uv sync
```

---

## Migration Path

### Phase 1: Add `uv` to Existing Setup

```bash
# 1. Install uv in sandbox
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Initialize Python project in workspace
uv init --name macro-workspace

# 3. Add dependencies
uv add pandas boring-macro-sdk

# 4. Update bootstrap script
uv sync
export PATH="$PWD/.venv/bin:$PATH"
```

### Phase 2: Replace pip with `uv`

```bash
# Old (pip)
pip install -r requirements.txt

# New (uv)
uv sync
```

### Phase 3: Lock Everything

```bash
# Generate lock file
uv lock

# Commit to git
git add uv.lock pyproject.toml

# Enforce locked installs
uv sync --frozen
```

---

## Comparison: `uv` vs Other Options

| Approach | Speed | Reproducibility | Complexity | Recommendation |
|----------|-------|-----------------|------------|----------------|
| **pip + requirements.txt** | Slow | Weak | Low | ❌ Avoid |
| **pip + pip-tools** | Medium | Medium | Medium | ⚠️ Okay |
| **Poetry** | Medium | Strong | High | ⚠️ Overkill |
| **pipenv** | Slow | Medium | High | ❌ Avoid |
| **uv** | **Fast** | **Strong** | **Low** | ✅ **Best** |

---

## Complete Example: SDK Package with `uv`

### boring-macro-sdk/

```
boring-macro-sdk/
├── pyproject.toml
├── uv.lock
├── src/
│   └── boring_macro/
│       ├── __init__.py
│       ├── _cli.py
│       └── transforms.py
├── transforms/
│   └── builtins/
│       └── yoy.py
└── README.md
```

### pyproject.toml

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "boring-macro-sdk"
version = "0.2.0"
description = "Macro SDK for boring.macro"
requires-python = ">=3.10"
dependencies = [
    "pandas>=2.0.0",
]

[project.scripts]
bm = "boring_macro._cli:main"

[tool.uv]
dev-dependencies = [
    "pytest>=8.0.0",
    "ruff>=0.5.0",
]
```

### Publish to PyPI

```bash
# Build
uv build

# Upload
uv publish
# Or: twine upload dist/*
```

---

## Key Takeaways

1. **`uv` is perfect for this use case** - Fast, reproducible, modern
2. **Works alongside NPM** - Use `uv` for Python, NPM for JS/tooling
3. **Minimal changes needed** - Just add `uv sync` to bootstrap
4. **Better than pip** - 10-100x faster, lock files, Python management
5. **Production-ready** - Used by major Python projects (Astral, Django, etc.)

### Recommended Setup for Boring Macro

```bash
# Sandbox bootstrap
curl -LsSf https://astral.sh/uv/install.sh | sh
uv sync
export PATH="$PWD/.venv/bin:$PATH"

# Agent can now run:
bm run --tool custom:ma12 --input CPIAUCSL --output CPIAUCSL_YOY
```

This gives you the **best of both worlds**: NPM ecosystem for tooling + `uv` for Python SDKs.
