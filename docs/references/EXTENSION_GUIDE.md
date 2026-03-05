# Extension Guide

This guide covers boring-ui's extension points for adding custom panels, routers, and configurations.

## Overview

boring-ui provides four main extension points:

1. **Pane Registry** - Register custom panel components for the UI
2. **Layout Manager** - Customize layout persistence and restoration
3. **App Config** - Configure branding, storage, and features
4. **Capabilities API** - Discover available features at runtime

## Pane Registry

The pane registry (`src/front/registry/panes.js`) manages panel components for the Dockview layout.

### Using the Registry

```javascript
import {
  registerPane,
  getPane,
  listPaneIds,
  essentialPanes,
  getComponents,
} from './registry/panes'

// Get all registered pane IDs
const paneIds = listPaneIds()
// => ['filetree', 'editor', 'terminal', 'shell', 'empty', 'review']

// Get essential panes (must exist in layout)
const essentials = essentialPanes()
// => ['filetree', 'terminal', 'shell']

// Get components map for Dockview
const components = getComponents()
// => { filetree: FileTreePanel, editor: EditorPanel, ... }
```

### Registering a Custom Pane

```javascript
import { registerPane } from './registry/panes'
import MyCustomPanel from './panels/MyCustomPanel'

registerPane({
  id: 'my-custom',
  component: MyCustomPanel,
  title: 'My Panel',
  placement: 'center',      // 'left' | 'center' | 'right' | 'bottom'
  essential: false,         // If true, must exist in layout
  locked: false,            // If true, group is locked (no close button)
  hideHeader: false,        // If true, group header is hidden
  constraints: {
    minWidth: 200,          // Minimum width in pixels
    minHeight: 150,         // Minimum height in pixels
  },
  requiresFeatures: ['files'],  // Required backend features
  requiresRouters: ['my-api'],  // Required backend routers
})
```

### Pane Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `id` | string | Unique identifier (required) |
| `component` | React.Component | Panel component (required) |
| `title` | string | Default panel title |
| `placement` | string | Default position: 'left', 'center', 'right', 'bottom' |
| `essential` | boolean | If true, pane must exist in layout |
| `locked` | boolean | If true, prevents closing tabs in group |
| `hideHeader` | boolean | If true, hides the group header |
| `constraints` | object | Size constraints: `minWidth`, `minHeight`, etc. |
| `requiresFeatures` | string[] | Backend features this pane requires (e.g., `['files']`) |
| `requiresRouters` | string[] | Backend routers this pane requires (e.g., `['pty']`) |

### Capability-Gated Panes

When a pane specifies `requiresFeatures` or `requiresRouters`, it will show an error state if those capabilities are unavailable:

```javascript
// Panes with requirements show clear error messages when unavailable
registerPane({
  id: 'code-sessions',
  component: CodeSessionsPanel,
  title: 'Code Sessions',
  requiresRouters: ['chat_claude_code'],  // Requires the Claude chat router
})
```

Built-in pane requirements:
- `filetree`, `editor`: requires `files` feature
- `terminal`: requires `chat_claude_code` router
- `shell`: requires `pty` router
- `review`: requires `approval` router

## Layout Manager

The layout manager (`src/front/layout/LayoutManager.js`) handles layout persistence.

### Storage Functions

```javascript
import {
  loadLayout,
  saveLayout,
  loadCollapsedState,
  saveCollapsedState,
  loadPanelSizes,
  savePanelSizes,
  getStorageKey,
} from './layout/LayoutManager'

// Load saved layout
const storagePrefix = 'my-app'
const projectRoot = '/path/to/project'
const layout = loadLayout(storagePrefix, projectRoot)

// Save layout
saveLayout(storagePrefix, projectRoot, dockApi.toJSON())

// Load/save collapsed state
const collapsed = loadCollapsedState(storagePrefix)
saveCollapsedState({ filetree: true, terminal: false }, storagePrefix)

// Load/save panel sizes
const sizes = loadPanelSizes(storagePrefix)
savePanelSizes({ filetree: 300, terminal: 400 }, storagePrefix)
```

### Layout Validation

```javascript
import { validateLayoutStructure, checkForSavedLayout } from './layout/LayoutManager'

// Check if a saved layout exists
const { hasSaved, invalidFound } = checkForSavedLayout('my-app')

// Validate layout structure
const isValid = validateLayoutStructure(layout)
```

## App Config

Configure boring-ui via `app.config.js` in your project root.

### Configuration Options

```javascript
// app.config.js
export default {
  // App branding
  branding: {
    name: 'My App',
    logo: 'M',  // String, React component, or element
    titleFormat: (ctx) => `${ctx.folder} - My App`,
  },

  // LocalStorage configuration
  storage: {
    prefix: 'my-app',      // Storage key prefix
    layoutVersion: 1,      // Increment to force layout reset
  },

  // Panel configuration
  panels: {
    essential: ['filetree', 'terminal', 'shell'],
    defaults: { filetree: 280, terminal: 400, shell: 250 },
    min: { filetree: 180, terminal: 250, shell: 100 },
    collapsed: { filetree: 48, terminal: 48, shell: 36 },
  },

  // Feature flags
  features: {
    codeSessions: true,
    agentRailMode: 'pi',
    controlPlaneOnboarding: false,
  },

  // Design tokens (CSS variables)
  styles: {
    light: { accent: '#3b82f6', accentHover: '#2563eb' },
    dark: { accent: '#60a5fa', accentHover: '#93c5fd' },
  },
}
```

### Using Config in Components

```javascript
import { useConfig } from './config'

function MyComponent() {
  const config = useConfig()

  return (
    <div>
      <h1>{config.branding.name}</h1>
      <span>{config.storage.prefix}</span>
    </div>
  )
}
```

### Vertical App Mode/Profile Contract

For downstream vertical apps, configure deployment mode and runtime profile explicitly:

```bash
# core mode defaults (recommended)
VITE_DEPLOY_MODE=core
VITE_UI_PROFILE=pi-lightningfs

# optional core profiles:
# VITE_UI_PROFILE=pi-cheerpx
# VITE_UI_PROFILE=pi-httpfs

# edge mode defaults
# VITE_DEPLOY_MODE=edge
# VITE_UI_PROFILE=companion-httpfs
```

Equivalent `app.config.js` shape:

```javascript
export default {
  mode: { deployMode: 'core', profile: 'pi-lightningfs' },
  features: { agentRailMode: 'pi' },
  data: { backend: 'lightningfs' }, // or cheerpx/http
}
```

Ownership rule for vertical apps:

- Keep workspace APIs in `boring-ui` core:
  - `/auth/*`
  - `/api/v1/me*`
  - `/api/v1/workspaces*`
  - `/api/v1/files/*`
  - `/api/v1/git/*`
- Add vertical/domain routes under your namespace (example: `/api/v1/macro/*`).

## Backend Router Registry

Add custom routers to the backend API.

### Adding a Router

```python
from boring_ui.api import create_app, RouterRegistry, create_default_registry

# Create custom registry
registry = create_default_registry()

# Register a custom router
registry.register(
    name='my-feature',
    prefix='/api/my-feature',
    factory=create_my_feature_router,
    description='My custom feature endpoints',
    tags=['custom'],
)

# Create app with custom registry
app = create_app(registry=registry)
```

### Router Factory Pattern

```python
from fastapi import APIRouter

def create_my_feature_router(config):
    """Create router for my feature."""
    router = APIRouter(tags=['my-feature'])

    @router.get('/items')
    async def list_items():
        return {'items': []}

    @router.post('/items')
    async def create_item(data: dict):
        return {'id': '123', **data}

    return router
```

### Selective Router Inclusion

```python
# Include only specific routers
app = create_app(routers=['files', 'git', 'my-feature'])

# Or exclude optional routers
app = create_app(include_pty=False, include_stream=False)
```

### Built-in Modules

boring-ui's backend API is organized into modules under `boring_ui/api/modules/`:

```
boring_ui/api/modules/
├── files/          # File operations (read, write, rename, delete)
│   ├── router.py
│   └── service.py
├── git/            # Git operations (status, diff, show)
│   ├── router.py
│   └── service.py
├── pty/            # PTY WebSocket for shell terminals
│   ├── router.py
│   └── service.py
└── stream/         # Claude stream WebSocket (chat_claude_code)
    ├── router.py
    └── service.py
```

Each module follows the router/service pattern for clean separation of concerns.

## Capabilities API

The `/api/capabilities` endpoint reports available features.

### Response Format

```json
{
  "version": "0.1.0",
  "features": {
    "files": true,
    "git": true,
    "pty": true,
    "chat_claude_code": true,
    "stream": true,
    "approval": true
  },
  "routers": [
    {
      "name": "files",
      "prefix": "/api",
      "description": "File system operations",
      "tags": ["files"],
      "enabled": true
    },
    {
      "name": "chat_claude_code",
      "prefix": "/ws",
      "description": "Claude stream WebSocket for AI chat",
      "tags": ["websocket", "ai"],
      "enabled": true
    }
  ]
}
```

Note: `chat_claude_code` is the canonical name for Claude chat functionality. `stream` is provided as a backward-compatible alias.

### Using Capabilities in Frontend

Use the `useCapabilities` hook to fetch and check capabilities:

```javascript
import { useCapabilities, isFeatureEnabled } from './hooks'

function MyComponent() {
  const { capabilities, loading, error } = useCapabilities()

  if (loading) return <div>Loading...</div>

  if (isFeatureEnabled(capabilities, 'pty')) {
    // PTY features available
  }

  if (isFeatureEnabled(capabilities, 'chat_claude_code')) {
    // Claude chat available
  }

  return <div>...</div>
}
```

For raw fetch access:

```javascript
async function checkCapabilities() {
  const response = await fetch('/api/capabilities')
  const { features, routers } = await response.json()

  if (features.pty) {
    // Enable terminal features
  }

  if (features.chat_claude_code) {
    // Enable Claude chat features
  }
}
```

## Best Practices

1. **Pane IDs**: Use lowercase, hyphenated IDs (e.g., `my-custom-panel`)
2. **Storage Prefix**: Use a unique prefix to avoid conflicts with other apps
3. **Essential Panes**: Only mark panes as essential if they're truly required
4. **Router Tags**: Use consistent tags for OpenAPI documentation
5. **Feature Flags**: Check capabilities before using optional features
6. **Layout Version**: Increment when making breaking layout changes

## See Also

- [README.md](../README.md) - Quick start guide
- [tests/unit/test_capabilities.py](../tests/unit/test_capabilities.py) - API test examples
