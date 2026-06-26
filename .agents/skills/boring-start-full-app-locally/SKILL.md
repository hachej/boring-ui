---
name: boring-start-full-app-locally
description: Start apps/full-app locally for manual testing, especially BORING_AGENT_MODE=vercel-sandbox and composer file uploads. Fixes Better Auth invalid-origin issues, exports .env safely, avoids killing unrelated processes, and creates/reuses the standard test user.
space: ops
context: any
output_format: terminal
---

# Start full-app locally

Use when Julien says "start full app locally", "run full-app", "test with vercel sandbox", "invalid origin", or asks for reusable full-app test credentials.

## Contract

- Do not print secrets from `.env` or `/proc/*/environ`.
- Do not kill unrelated processes. Only stop a process on the target port if its cwd is this repo's `apps/full-app` or a known boring-ui worktree `apps/full-app`.
- Prefer the current checkout/worktree the user asked about. If testing an open PR, use that PR worktree.
- Full-app dev frontend is **5173** unless `apps/full-app/src/server/dev.ts` is changed; do not assume `5174` works.
- API port should be **3001** for local manual testing so it does not collide with other apps on 3000.
- Always set `BORING_AGENT_MODE=vercel-sandbox` when the user wants Vercel sandbox behavior.
- Fix Better Auth origin before starting: `BETTER_AUTH_URL` and `CORS_ORIGINS` must include the browser origin the user will open.

## Standard reusable test user

Use these creds unless Julien gives different ones:

- Email: `test@boring.local`
- Password: `boring-test-password-2026`
- Name: `Boring Test User`

Create it idempotently by trying sign-up, then sign-in. Existing-user sign-up errors are OK if sign-in succeeds.

## Start procedure

From repo root (or PR worktree root):

```bash
APP_ORIGIN="${APP_ORIGIN:-http://213.32.19.186:5173}"
API_PORT="${API_PORT:-3001}"
APP_PORT="5173"
LOG=.pi/logs/full-app-vercel-sandbox.log
PID=.pi/logs/full-app-vercel-sandbox.pid
mkdir -p .pi/logs
```

### 1. Ensure full-app env exists

If `apps/full-app/.env` is missing, copy from a known working checkout or `.env.example`, then fill secrets. For local testing, never echo values.

Required keys:

```bash
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
WORKSPACE_SETTINGS_ENCRYPTION_KEY
MAIL_FROM
MAIL_TRANSPORT_URL
VERCEL_TOKEN
VERCEL_TEAM_ID
VERCEL_PROJECT_ID
```

### 2. Patch origin/ports safely

```bash
python - <<'PY'
from pathlib import Path
import os
p = Path('apps/full-app/.env')
origin = os.environ.get('APP_ORIGIN', 'http://213.32.19.186:5173')
api_port = os.environ.get('API_PORT', '3001')
origins = [
    origin,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    f'http://localhost:{api_port}',
    f'http://127.0.0.1:{api_port}',
]
if origin.startswith('http://213.32.19.186:'):
    origins.append(f'http://213.32.19.186:{api_port}')
lines = p.read_text().splitlines()
out = []
seen = set()
for line in lines:
    if line.startswith('BETTER_AUTH_URL='):
        out.append(f'BETTER_AUTH_URL={origin}')
        seen.add('BETTER_AUTH_URL')
    elif line.startswith('CORS_ORIGINS='):
        existing = [x.strip() for x in line.split('=', 1)[1].split(',') if x.strip()]
        merged = []
        for item in existing + origins:
            if item not in merged:
                merged.append(item)
        out.append('CORS_ORIGINS=' + ','.join(merged))
        seen.add('CORS_ORIGINS')
    elif line.startswith('PORT='):
        out.append(f'PORT={api_port}')
        seen.add('PORT')
    elif line.startswith('HOST='):
        out.append('HOST=0.0.0.0')
        seen.add('HOST')
    elif line.startswith('BORING_AGENT_MODE='):
        out.append('BORING_AGENT_MODE=vercel-sandbox')
        seen.add('BORING_AGENT_MODE')
    else:
        out.append(line)
if 'BETTER_AUTH_URL' not in seen: out.append(f'BETTER_AUTH_URL={origin}')
if 'CORS_ORIGINS' not in seen: out.append('CORS_ORIGINS=' + ','.join(origins))
if 'PORT' not in seen: out.append(f'PORT={api_port}')
if 'HOST' not in seen: out.append('HOST=0.0.0.0')
if 'BORING_AGENT_MODE' not in seen: out.append('BORING_AGENT_MODE=vercel-sandbox')
p.write_text('\n'.join(out) + '\n')
print(f'origin={origin}')
print(f'api_port={api_port}')
print('env patched without printing secrets')
PY
```

### 3. Stop only an old boring-ui full-app on these ports

```bash
python - <<'PY'
import os, signal, subprocess
from pathlib import Path
allowed_suffix = '/apps/full-app'
ports = {'5173', os.environ.get('API_PORT', '3001')}
try:
    out = subprocess.check_output(['ss', '-ltnp'], text=True)
except Exception:
    out = ''
for line in out.splitlines():
    if not any(f':{p} ' in line for p in ports):
        continue
    if 'pid=' not in line:
        continue
    pid = line.split('pid=', 1)[1].split(',', 1)[0]
    try:
        cwd = os.readlink(f'/proc/{pid}/cwd')
    except OSError:
        continue
    if cwd.endswith(allowed_suffix) and 'boring-ui' in cwd:
        print(f'stopping old full-app pid={pid} cwd={cwd}')
        try:
            os.kill(int(pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
    else:
        raise SystemExit(f'port busy by unrelated process pid={pid} cwd={cwd}; do not kill it')
PY
sleep 2
```

### 4. Start with `.env` exported

Do not rely on shell env alone; export `apps/full-app/.env` into the spawned process.

```bash
python - <<'PY'
import os, subprocess
from pathlib import Path
root = Path.cwd()
env = os.environ.copy()
for line in (root / 'apps/full-app/.env').read_text().splitlines():
    s = line.strip()
    if not s or s.startswith('#') or '=' not in s:
        continue
    k, v = s.split('=', 1)
    k = k.strip(); v = v.strip()
    if len(v) >= 2 and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
        v = v[1:-1]
    env[k] = v
env['BORING_AGENT_MODE'] = 'vercel-sandbox'
env['PORT'] = os.environ.get('API_PORT', env.get('PORT', '3001'))
env['HOST'] = '0.0.0.0'
log_path = root / '.pi/logs/full-app-vercel-sandbox.log'
pid_path = root / '.pi/logs/full-app-vercel-sandbox.pid'
log_path.parent.mkdir(parents=True, exist_ok=True)
log = open(log_path, 'wb')
proc = subprocess.Popen(['pnpm', '--filter', 'full-app', 'dev'], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
pid_path.write_text(str(proc.pid))
print(f'pid={proc.pid}')
print(f'log={log_path}')
PY
```

### 5. Wait for readiness

```bash
for i in $(seq 1 180); do
  if grep -q 'core-workspace-agent.vite.ready\|Local:' "$LOG"; then break; fi
  if grep -q 'EADDRINUSE\|ConfigValidationError\|Invalid origin\|Error:' "$LOG"; then tail -80 "$LOG"; exit 1; fi
  sleep 2
done
tail -50 "$LOG"
curl -fsS "http://127.0.0.1:${API_PORT}/health" && echo
```

Expected URLs:

- Browser: `${APP_ORIGIN}` (usually `http://213.32.19.186:5173` for remote testing)
- Local browser on the same machine: `http://localhost:5173`
- API: `http://127.0.0.1:${API_PORT}`

### 6. Create/reuse test user

```bash
ORIGIN="${APP_ORIGIN:-http://213.32.19.186:5173}"
API="http://127.0.0.1:${API_PORT:-3001}"
EMAIL='test@boring.local'
PASSWORD='boring-test-password-2026'
NAME='Boring Test User'

# Try signup. Existing-user errors are acceptable if sign-in succeeds below.
curl -sS -o /tmp/full-app-signup.json -w 'signup_http=%{http_code}\n' \
  -X POST "$API/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -H "origin: $ORIGIN" \
  -H "referer: $ORIGIN/auth/signup" \
  --data "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"$NAME\"}"

# Must succeed.
curl -sS -o /tmp/full-app-signin.json -w 'signin_http=%{http_code}\n' \
  -X POST "$API/auth/sign-in/email" \
  -H 'content-type: application/json' \
  -H "origin: $ORIGIN" \
  -H "referer: $ORIGIN/auth/signin" \
  --data "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
cat /tmp/full-app-signin.json | head -c 300; echo
```

Also verify common origins:

```bash
for origin in 'http://localhost:5173' 'http://127.0.0.1:5173' "$APP_ORIGIN"; do
  curl -sS -o /tmp/origin-check.json -w "$origin -> %{http_code}\n" \
    -X POST "http://127.0.0.1:${API_PORT}/auth/sign-in/email" \
    -H 'content-type: application/json' \
    -H "origin: $origin" \
    -H "referer: $origin/auth/signin" \
    --data '{"email":"test@boring.local","password":"boring-test-password-2026"}'
done
```

## Final response checklist

Report:

- Browser URL
- API URL
- PID
- Log path
- Confirm `BORING_AGENT_MODE=vercel-sandbox`
- Confirm Vercel env keys are present (do not print values)
- Test creds
- Stop command
