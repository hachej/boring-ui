# Python SDK Integration Options

## The Challenge

Python packages are typically distributed via **PyPI** (pip), not **NPM**. However, agent sandboxes need executables in their PATH. Here are the viable approaches:

---

## Option 1: NPM Package with Python Runtime (Recommended)

**Concept:** Package Python code in an NPM package, ship a Node.js wrapper that invokes Python.

### Structure

```
@boring/macro-sdk/
├── package.json
├── bin/
│   └── bm.js          # Node wrapper (shebang: #!/usr/bin/env node)
├── sdk/
│   └── boring_macro/
│       ├── _cli.py
│       ├── run_transform.py
│       └── __init__.py
└── transforms/
    └── builtins/
        └── yoy.py
```

### package.json

```json
{
  "name": "@boring/macro-sdk",
  "version": "0.2.0",
  "bin": {
    "bm": "./bin/bm.js"
  },
  "files": ["bin", "sdk", "transforms"],
  "engines": {
    "node": ">=18",
    "python": ">=3.10"
  }
}
```

### bin/bm.js

```javascript
#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const cliPath = join(__dirname, '../sdk/boring_macro/_cli.py');
const args = process.argv.slice(2);

const child = spawn('python3', [cliPath, ...args], {
  stdio: 'inherit',
  env: { ...process.env, WORKSPACE_ROOT: process.cwd() }
});

child.on('exit', code => process.exit(code));
```

### Pros

- ✅ **Works with existing NPM workflow** - Same as JS SDKs
- ✅ **Single package** - One `npm install` gets you everything
- ✅ **No pip dependencies** - Python code is bundled, not installed
- ✅ **Version pinning** - SDK version locked in `package.json`
- ✅ **Works in all sandbox modes** - NPM is universal

### Cons

- ⚠️ **Python runtime required** - Sandbox must have `python3` installed
- ⚠️ **No pip dependencies** - Can't use `pandas`, `numpy`, etc. unless bundled or pre-installed

### When to Use

- SDK has **no Python dependencies** (or they're pre-installed in sandbox)
- You want **simplest deployment** (one `npm install`)
- Sandboxes have **Python runtime available**

---

## Option 2: PyPI Package + pip Install

**Concept:** Publish to PyPI, install via `pip install` in workspace.

### Structure

```
boring-macro-sdk/
├── pyproject.toml
├── src/
│   └── boring_macro/
│       ├── __init__.py
│       └── _cli.py
└── README.md
```

### pyproject.toml

```toml
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

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
```

### Installation in Workspace

```bash
# Option A: pip install
pip install boring-macro-sdk

# Option B: pip install from local path
pip install /path/to/boring-macro-sdk

# Option C: pip install from git
pip install git+https://github.com/.../boring-macro-sdk.git
```

### Pros

- ✅ **Native Python distribution** - Standard PyPI workflow
- ✅ **Dependencies handled** - pip resolves `pandas`, `numpy`, etc.
- ✅ **Entry points** - `python -m` and CLI auto-configured
- ✅ **Virtual environments** - Can use `venv` for isolation

### Cons

- ⚠️ **pip must be available** - Sandbox needs Python + pip
- ⚠️ **Slower installs** - pip resolves dependencies, compiles wheels
- ⚠️ **Version drift** - Python and NPM versions can get out of sync
- ⚠️ **Not universal** - Some sandboxes may not have Python/pip

### When to Use

- SDK **requires Python dependencies** (pandas, numpy, etc.)
- You're **Python-first** team
- Sandboxes have **Python/pip pre-installed**

---

## Option 3: Hybrid (NPM + PyPI)

**Concept:** Publish to BOTH registries. NPM for JS tools, PyPI for Python CLI.

### Structure

```
monorepo/
├── packages/
│   ├── macro-npm/           # NPM package (Node wrapper)
│   └── macro-pypi/          # PyPI package (Python SDK)
└── sdk/
    └── boring_macro/        # Shared Python source
```

### Workflow

```bash
# Install NPM wrapper (for JS tool integration)
npm install @boring/macro-sdk

# Install Python SDK (for CLI + dependencies)
pip install boring-macro-sdk
```

### Pros

- ✅ **Best of both worlds** - NPM for JS, PyPI for Python
- ✅ **Full dependency support** - pip handles Python deps
- ✅ **Flexible usage** - Can use either interface

### Cons

- ⚠️ **Two packages to maintain** - Version sync required
- ⚠️ **Two install steps** - More complex setup
- ⚠️ **Potential conflicts** - Two versions of same code

### When to Use

- SDK is **large and complex** with many dependencies
- You need **both JS and Python interfaces**
- Team has **mature CI/CD** for dual publishing

---

## Option 4: Pre-bundled Python (Advanced)

**Concept:** Bundle Python interpreter + dependencies into NPM package.

### Tools

- **PyInstaller** - Bundle Python + deps into single binary
- **Nuitka** - Compile Python to C extension
- **shiv** - Create executable zipapps

### Example with shiv

```bash
# Build executable zipapp
shiv -c bm -o bm pyproject.toml

# Package in NPM
{
  "bin": {
    "bm": "./bin/bm"
  }
}
```

### Pros

- ✅ **Zero Python dependency** - Self-contained binary
- ✅ **Works anywhere** - No runtime requirements
- ✅ **Fast startup** - No interpreter launch overhead

### Cons

- ⚠️ **Large bundle size** - Python runtime ~10-50MB
- ⚠️ **Platform-specific** - Need builds for Linux/macOS/Windows
- ⚠️ **Complex CI** - Cross-compilation required

### When to Use

- **Production deployments** where Python isn't guaranteed
- **Offline environments** - No package managers available
- **Maximum portability** required

---

## Recommended Approach for Boring Macro

Given your current setup:

### Current State
- Python CLI: `sdk/boring_macro/_cli.py`
- Dependencies: `pandas` (for transform execution)
- Target: Agent sandboxes (bwrap, direct, vercel-sandbox)

### Recommendation: **Option 1 (NPM Package)** with caveats

**Why:**
1. Your sandboxes likely already have Python (for other tooling)
2. `pandas` can be pre-installed in sandbox images
3. NPM workflow is already established in the repo
4. Simpler than dual-publishing to PyPI

### Implementation

**Step 1: Create NPM package structure**

```bash
mkdir -p apps/boring-macro-v2/sdk/package
cd apps/boring-macro-v2/sdk/package

# Copy existing Python code
cp -r ../boring_macro/ sdk/
cp -r ../transforms/ transforms/

# Add package.json (see above)
# Add bin/bm.js (see above)
```

**Step 2: Ensure Python dependencies in sandbox**

```bash
# In your sandbox setup (Dockerfile or bootstrap script)
RUN apt-get install -y python3 python3-pip
RUN pip3 install pandas

# Or in workspace template
{
  "scripts": {
    "postinstall": "pip3 install pandas"
  }
}
```

**Step 3: Publish and use**

```bash
# Publish
npm publish  # or private registry

# In workspace template
{
  "dependencies": {
    "@boring/macro-sdk": "0.2.0"
  }
}
```

### Fallback: Option 2 (PyPI) if needed

If Python dependencies become complex:

```toml
# pyproject.toml
[project]
name = "boring-macro-sdk"
version = "0.2.0"
dependencies = [
    "pandas>=2.0.0",
    "clickhouse-connect>=0.7.0",
]

[project.scripts]
bm = "boring_macro._cli:main"
```

```bash
# Publish to PyPI
python -m build
twine upload dist/*

# Install in workspace
pip install boring-macro-sdk
```

---

## Sandboxes Python Availability

| Sandbox Mode | Python Available? | Notes |
|--------------|-------------------|-------|
| **direct** (macOS/Windows) | ✅ Usually | Dev machines have Python |
| **local** (bwrap on Linux) | ⚠️ Depends | Need to install in base image |
| **vercel-sandbox** | ⚠️ Depends | Custom runtime image needed |

### Recommendation for Each Mode

```typescript
// In your sandbox adapter
if (mode === 'direct') {
  // Assume Python available on dev machines
  return { python: 'python3' };
}

if (mode === 'local') {
  // bwrap sandbox - ensure Python in base image
  // Dockerfile: RUN apt-get install python3 python3-pip
  return { python: 'python3' };
}

if (mode === 'vercel-sandbox') {
  // Use custom runtime with Python pre-installed
  // Or fall back to Node wrapper only
  return { python: process.env.PYTHON_PATH || 'python3' };
}
```

---

## Decision Matrix

| Requirement | Best Option |
|-------------|-------------|
| No Python dependencies | **Option 1** (NPM package) |
| Has Python dependencies | **Option 2** (PyPI package) |
| Both JS + Python interfaces | **Option 3** (Hybrid) |
| Zero runtime requirements | **Option 4** (Pre-bundled) |
| Simplest setup | **Option 1** (NPM package) |
| Production deployment | **Option 2 or 4** |

---

## Migration Path for Boring Macro

### Phase 1: NPM Package (Quick Win)

1. Create `bin/bm.js` wrapper
2. Package Python code in NPM structure
3. Update workspace template to include SDK
4. Ensure sandboxes have Python + pandas

### Phase 2: PyPI Package (If Needed)

1. If dependencies grow complex, create `pyproject.toml`
2. Publish to PyPI (private or public)
3. Update workspace to `pip install` SDK
4. Keep NPM package as JS tool interface only

### Phase 3: Hybrid (If Required)

1. Dual-publish to both registries
2. NPM package for `@boring/agent` tool integration
3. PyPI package for CLI + dependencies

---

## Key Takeaway

**Yes, it works for Python packages** - you just need to choose the right distribution mechanism:

- **NPM package** = simplest, works if Python runtime available
- **PyPI package** = native Python, handles dependencies
- **Hybrid** = both, most flexible but complex

For your current setup (boring-macro with pandas), I recommend **starting with NPM package** and ensuring sandboxes have Python + pandas pre-installed. If that becomes limiting, migrate to PyPI.
