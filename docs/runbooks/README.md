# Runbooks

Operational runbooks for common tasks.

## Development

### Start Local Dev Environment

```bash
# Terminal 1: Frontend dev server (HMR)
npm install
npm run dev
# -> http://localhost:5173

# Terminal 2: Backend API
uv sync
uv run python -m uvicorn boring_ui.runtime:app --host 0.0.0.0 --port 8000 --reload
```

### Start Optional Companion / PI Services

```bash
# Separate terminal(s)
npm run companion:service
npm run pi:service
```

### Run Tests

```bash
# Frontend unit tests
npm run test:run

# Frontend unit tests (watch mode)
npm test

# Frontend E2E tests
npm run test:e2e

# Backend tests
python3 -m pytest tests/ -v

# Lint
npm run lint

# Smoke gate
scripts/gates/smoke.sh
```

### Build for Production

```bash
# App build
npm run build

# Library build (for use as npm package)
npm run build:lib

# Preview production build
npm run preview
```

## Downstream Packaging Helper

For apps embedding boring-ui (for example `boring-macro`), use:

```bash
python3 scripts/package_app_assets.py \
  --frontend-dir /path/to/app/frontend \
  --static-dir /path/to/app/runtime_static \
  --companion-source /path/to/boring-ui/src/companion_service/launch.sh \
  --companion-target /path/to/app/runtime_companion/launch.sh
```

## Configuration

### Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API key for chat sessions | (required for chat) |
| `CORS_ORIGINS` | Comma-separated allowed origins | Dev origins + `*` |
| `COMPANION_URL` | Companion service URL | None (embedded mode) |
| `PI_URL` | PI service URL | None (embedded mode) |
| `PI_MODE` | PI rendering: `embedded` or `iframe` | `embedded` |
| `WORKSPACE_PLUGINS_ENABLED` | Enable workspace plugins | `false` |
| `WORKSPACE_PLUGIN_ALLOWLIST` | Comma-separated allowed plugins | (empty = all if enabled) |
| `LOCAL_PARITY_MODE` | `http` to exercise hosted code path locally | (unset) |

### Hosted Mode (Parity Testing)

To test hosted-mode code paths locally:

```bash
export LOCAL_PARITY_MODE=http
# Frontend will rewrite /api/* to /api/v1/* as in hosted mode
```

## Troubleshooting

### Layout Corrupted / Blank Screen
Clear localStorage for the app's storage prefix:
```javascript
// In browser console
Object.keys(localStorage).filter(k => k.startsWith('boring-ui')).forEach(k => localStorage.removeItem(k))
location.reload()
```

### Capabilities Endpoint Returns Unexpected Features
Check which routers are enabled in `create_app()`. The `/api/capabilities` response reflects exactly what was mounted. Verify with:
```bash
curl http://localhost:8000/api/capabilities | python3 -m json.tool
```

### PTY WebSocket Won't Connect
1. Verify `pty` is in enabled routers
2. Check PTY providers in config: `curl http://localhost:8000/api/config`
3. Ensure the provider name in the WS query matches a configured provider

### Chat Sessions Not Working
1. Check capabilities: `curl http://localhost:8000/api/capabilities`
2. If using companion, verify `COMPANION_URL` (or companion service availability)
3. If using Claude stream, verify `ANTHROPIC_API_KEY` and `chat_claude_code` capability
