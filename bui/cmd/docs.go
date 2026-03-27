package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var docsCmd = &cobra.Command{
	Use:   "docs [topic]",
	Short: "Show detailed guides for bui commands",
	Long:  `Browse built-in guides. Run without args to see available topics.`,
	Args:  cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) == 0 {
			printDocsIndex()
			return nil
		}
		topic := args[0]
		text, ok := docTopics[topic]
		if !ok {
			fmt.Printf("Unknown topic: %q\n\n", topic)
			printDocsIndex()
			return fmt.Errorf("topic %q not found", topic)
		}
		fmt.Println(text)
		return nil
	},
}

func init() {
	rootCmd.AddCommand(docsCmd)
}

func printDocsIndex() {
	fmt.Println(`bui docs — Available topics:

  bui docs quickstart  Autonomous end-to-end: init → deploy (start here)
  bui docs init       Scaffold a new child app
  bui docs dev        Dev server setup and framework resolution
  bui docs deploy     Build, secrets, Fly/Modal/Docker deploy workflow
  bui docs neon       Neon Postgres + Auth setup, teardown, troubleshooting
  bui docs config     boring.app.toml schema reference
  bui docs auth       Auth provider architecture and session cookies
  bui docs github     GitHub App integration setup
  bui docs smoke      Smoke test suite and recommended sequences`)
}

var docTopics = map[string]string{
	"quickstart": `
=== Autonomous Child App: Init → Deploy ===

Complete sequence for creating, validating, and deploying a new boring-ui
child app. Every step uses bui CLI — no manual framework wiring needed.

--- Prerequisites ---

  - bui CLI on PATH (this binary)
  - ../boring-ui/ exists (or BUI_FRAMEWORK_PATH set)
  - Vault accessible: VAULT_ADDR + VAULT_TOKEN set
  - Fly CLI on PATH + FLY_API_TOKEN set (or fly auth login)
  - Node.js + npm for frontend build

--- Step-by-step ---

  1. Scaffold:
     cd /home/ubuntu/projects
     bui init <app-name>
     cd <app-name>

     This creates boring.app.toml, package.json, starter backend wiring,
     .gitignore, and .dockerignore. Treat the scaffold as a starting point —
     replace the example feature with the real routes and panels your app needs.

  2. Implement your app features using the current scaffold:
     - Add or replace backend routes in src/server/index.ts or files under src/server/routes/.
     - The default scaffold is TypeScript. Use 'bui init --python' only when you explicitly need the legacy Python child-app path.
     - Add custom panels under panels/ and declare them in [frontend.panels].
     - If you need root-level routes such as /health, /info, or /whoami,
       add them in the scaffolded TS entrypoint before calling listen().
     - If a feature must survive deploys, restarts, or multiple Fly machines,
       back it with shared persistence such as DATABASE_URL-backed storage, not
       process-local memory.

     No separate git init/commit is required unless your own workflow
     specifically needs local repo history.

  3. Provision Neon (auth + database for local and hosted parity):
     bui neon setup
     # Auto-configures Resend for verification emails (if key in Vault)
     # Stores app-specific creds in secret/agent/app/<app-id>/prod or .boring/
     # For hosted apps, final auth should be Neon-backed, not local.

  4. Validate:
     bui doctor

  5. Local dev test:
     bui dev --backend-only
     # In another terminal:
     # After 'bui neon setup', bui dev prefers a trusted 127.0.0.1 loopback
     # port for callback flows (for example :5176) unless you override --port.
     curl http://127.0.0.1:5176/api/capabilities
     curl http://127.0.0.1:5176/health
     # Exercise the routes and panels you just added.
     # Prefer focused checks for required behavior over broad redundant sweeps.

  6. Deploy to Fly:
     bui deploy
     # Creates Fly app if needed, builds frontend, resolves secrets, deploys

  7. Verify live:
     curl https://<app-name>.fly.dev/health
     curl https://<app-name>.fly.dev/api/capabilities
     # Then verify the specific routes and UI you added live.

--- How it works under the hood ---

  boring-ui is a framework. Your child app is a config + custom code.
  bui dev resolves the framework root, wires BUI_FRAMEWORK_ROOT for TS child
  apps, and runs the [backend].entry from boring.app.toml.

  The default TypeScript scaffold points [backend].entry at src/server/index.ts,
  dynamically imports the framework server from BUI_FRAMEWORK_ROOT, and
  registers your child routes on top of the framework app before listen().
  If you explicitly need the legacy Python child-app loader, scaffold with
  'bui init --python'.

--- Key config fields ---

  [backend].entry     The backend entrypoint (TS scaffold default: src/server/index.ts)
  [backend].routers   Legacy Python-only dotted router paths
  [deploy].platform   "fly" (default), "modal", or "docker"
  [auth].provider     "local" (dev) or "neon" (production, set by bui neon setup)

--- Adding backend routes ---

  Create the routes your app needs in src/server/index.ts or src/server/routes/*,
  then register them on the Fastify app returned by the framework createApp().
  If you explicitly use the Python scaffold instead, [backend].routers remains
  available for dotted router paths.

--- Root-level routes (overriding framework defaults) ---

  The default TS scaffold already gives you a custom entry point:

  # src/server/index.ts
  const app = createApp({ config, logger: true, skipValidation: true })
  app.get('/info', async () => ({ name: '<app>', version: '0.1.0' }))
  registerMyRoutes(app)
  app.listen(...)

  IMPORTANT: keep your app on the TypeScript backend path for the current
  migration/eval lane. Do not switch back to the legacy Python child-app
  loader unless you are intentionally using 'bui init --python'.

--- Local dev testing ---

  bui dev --backend-only           # uses entry from boring.app.toml
  # Test in another terminal:
  # If auth is local, this usually binds :8000.
  # If auth.provider = "neon", bui dev prefers a trusted 127.0.0.1 loopback
  # port such as :5176 and injects the local callback env automatically.
  curl http://127.0.0.1:5176/health
  curl http://127.0.0.1:5176/api/capabilities

  If you need a specific port:
  # For local Neon auth/email callback testing, prefer a trusted loopback port:
  bui dev --backend-only --port 5176

  To kill leftover dev servers:
  pkill -f "tsx watch src/server/index.ts" 2>/dev/null

--- Secrets (never hardcode) ---

  [deploy.secrets]
  ANTHROPIC_API_KEY = { vault = "secret/agent/anthropic", field = "api_key" }
  MY_SECRET         = { vault = "secret/agent/app/<id>/prod", field = "my_secret" }

  bui deploy resolves these from Vault at deploy time.
  bui neon setup auto-stores database/auth creds in secret/agent/app/<id>/prod.
  For hosted apps, final auth should be Neon-backed, not local.

  IMPORTANT:
  - Never put literal secret values in boring.app.toml or source files.
  - Never print raw secrets in logs, reports, or commit messages.
  - Always use { vault = "...", field = "..." } refs in [deploy.secrets].

--- Adding a custom panel ---

  # panels/NotesPanel.jsx
  export default function NotesPanel() {
    return <div>My custom panel</div>
  }

  # boring.app.toml
  [frontend.panels]
  notes = { component = "./panels/NotesPanel.jsx", title = "Notes", placement = "right" }

--- Scope rules ---

  - Keep all changes inside your child app directory.
  - Do not modify ../boring-ui/ or other sibling project directories.
  - The framework is read-only — your app extends it via config and routers.

--- Cleanup ---

  bui neon destroy    Delete Neon project + clean Vault
  fly apps destroy <app-name> --yes
`,

	"init": `
=== bui init — Child App Scaffolding ===

  bui init <name>
  bui init --go <name>
  bui init --python <name>

Default TypeScript scaffold creates:
  boring.app.toml       App config (name, backend, frontend, deploy)
  package.json          TS runtime dependency for local/dev deploy usage
  src/server/index.ts   Child app entrypoint
  src/server/routes/    Example route module
  panels/               Custom React panels
  .gitignore            Standard ignores
  .dockerignore         Keeps .git/.venv/dist/node_modules out of Fly builds
  .env.example          Template for local dev secrets

Python scaffold (--python) creates:
  boring.app.toml       App config with Python backend entry
  pyproject.toml        Python package definition
  src/<name>/routers/   Custom FastAPI routers (example included)
  panels/               Custom React panels
  .gitignore            Standard ignores
  .dockerignore         Keeps .git/.venv/dist/node_modules out of Fly builds
  .env.example          Template for local dev secrets

Go scaffold creates:
  boring.app.toml       App config with [backend].type = "go"
  go.mod / go.sum       Go module pinned to boring-ui
  main.go               Child app entrypoint with default module wiring
  hello/module.go       Example module and route
  .gitignore            Standard ignores
  .dockerignore         Keeps .git/.venv/dist/node_modules out of Fly builds
  .env.example          Template for local dev secrets

If ../boring-ui is present, the Go scaffold adds a local replace and runs 'go mod tidy'
so 'go build ./...' works immediately. Without a local framework sibling, init still
completes and prints the follow-up 'go get ... && go mod tidy' step.

After init:
  cd <name>
  cp .env.example .env          # add your API keys
  bui dev                       # auto-detects ../boring-ui
  bui neon setup                # provision database + auth for final deploy
  bui deploy                    # build + deploy to Fly.io

For production, the final app should use Neon auth and app-scoped Vault refs under:
  secret/agent/app/<name>/prod

Name must be lowercase alphanumeric with hyphens (e.g. boring-macro).
`,

	"dev": `
=== bui dev — Dev Server ===

Starts the configured backend + vite with hot-reload.

Framework resolution (in order):
  1. ../boring-ui/ exists with boring.app.toml  → use it
  2. BUI_FRAMEWORK_PATH env var set             → use that path
  3. Neither                                    → git fetch [framework].commit to ~/.bui/cache/

Backend runner by [backend].type:
  - python      → uvicorn <entry> [--factory] --reload
  - typescript  → tsx watch <entry>
  - go          → air (build target from backend.entry)

What happens on start:
  - For python backends only:
      - Creates .venv if needed (per-project Python isolation)
      - pip install -e <boring-ui>     (editable, instant reload)
      - pip install -e .               (child app, if pyproject.toml exists)
  - Symlinks node_modules/boring-ui → framework path
  - Reads .env for local secrets (ANTHROPIC_API_KEY, etc.)

boring-ui core note:
  - The framework itself now defaults to the TypeScript server path
    (backend.type = "typescript", entry = "src/server/index.ts")
  - Default child-app scaffolds now use the TypeScript backend path
  - Use 'bui init --python' only when you explicitly need the legacy Python scaffold

Go backend notes:
  - backend.type = "go" requires air in PATH
  - backend.entry becomes the go build target for air
  - bui init --go writes backend.entry = "." so bui dev builds the app root

Flags:
  --backend-only      Only backend process (attach debugger separately)
  --frontend-only     Only vite (use browser DevTools)
  --port N            Override backend port
  --vite-port N       Override frontend port

Neon local-dev note:
  - After 'bui neon setup', plain 'bui dev' prefers a trusted 127.0.0.1
    loopback port (for example :5176) unless you override --port.
  - It also injects BORING_UI_PUBLIC_ORIGIN and disables secure cookies for
    the local callback flow.

Local auth shortcut:
  export AUTH_DEV_LOGIN_ENABLED=true
  export BORING_UI_SESSION_SECRET="dev-only-local-secret"
  curl "http://localhost:8000/auth/login?user_id=u1&email=user@example.com&redirect_uri=/"
`,

	"deploy": `
=== bui deploy — Deployment ===

Builds frontend, resolves Vault secrets, deploys to the configured platform.

Steps:
  1. Check framework drift (warn if ../boring-ui HEAD != pinned commit)
  2. Build frontend: vite build → dist/web/ (skip with --skip-build)
  3. Resolve [deploy.secrets] from Vault
  4. Inject [deploy.neon] config URLs as env vars
  5. Fallback: .boring/neon-config.env for DB URL if not in Vault
  6. Deploy using [deploy].platform

Platforms:
  fly      Run 'fly deploy -c deploy/fly/fly.toml' with resolved env vars
  modal    Run 'modal deploy' with resolved env vars
  docker   Build + push image, copy compose/Caddy assets, restart remote Docker Compose over SSH

Environment isolation (--env flag):
  --env prod      Vault: secret/agent/app/{id}/prod
  --env staging   Vault: secret/agent/app/{id}/staging
  --env dev       Vault: secret/agent/app/{id}/dev

Prerequisites:
  - Vault accessible (VAULT_ADDR + VAULT_TOKEN)
  - flyctl (or fly) installed and authenticated for Fly deploys
  - modal CLI installed and authenticated for modal deploys
  - docker buildx + registry login for docker deploys
  - SSH access to the target host for docker deploys
  - Node.js + npm for frontend build

Session persistence:
  BORING_UI_SESSION_SECRET must be stable across deploys.
  Without it, every redeploy invalidates all session cookies.
  'bui neon setup' generates and stores this automatically.

Docker config example:
  [deploy]
  platform = "docker"

  [deploy.docker]
  registry = "ghcr.io/hachej"
  compose_file = "deploy/docker-compose.prod.yml"
  host = "app.example.com"
  ssh_key_vault = "secret/agent/hetzner-ssh"
`,

	"neon": `
=== bui neon — Neon Postgres + Auth ===

Commands:
  bui neon setup     Provision project, schema, auth, store creds
  bui neon status    Check DB, auth, JWKS health
  bui neon destroy   Delete project, clean Vault, reset config

--- Setup prerequisites ---

  1. Neon API key in Vault:
     vault kv put secret/agent/neon api_key=<your-neon-api-key>

  2. Vault write access to secret/agent/app/* (or accept local fallback)

  3. psql available for schema application

--- What setup does ---

  1. Creates Neon project in specified region (default: aws-eu-central-1)
  2. Builds direct + pooler connection URLs
  3. Runs the framework control-plane bootstrap/migrations from deploy/sql/*.sql
  4. Enables Neon Auth (Better Auth, email/password, EdDSA JWT)
  5. Configures email provider if --email-provider is set
  6. Generates session secret
  7. Stores all creds in Vault at: secret/agent/app/{app-id}/{env}
     Falls back to .boring/neon-config.env if Vault write fails
  8. Updates boring.app.toml with endpoints and Vault references

--- Email provider (--email-provider) ---

  resend   Configures Resend SMTP via Neon API (fetches API key from Vault)
  smtp     Prints generic SMTP instructions (manual Neon Console config)
  none     Skip email provider (default — no verification emails)

  With --email-provider resend, the CLI automatically:
    1. Fetches Resend API key from Vault (secret/agent/services/resend)
    2. Calls Neon API to configure SMTP (PATCH /projects/{id}/auth/email_server)
    No manual Console step needed.

  Resend SMTP credentials (for reference):
    Host: smtp.resend.com, Port: 465, Username: resend, Password: <API key>

--- Neon Auth details ---

  Algorithm: EdDSA (Ed25519) — requires PyJWT[crypto]>=2.8.0
  Important: 'token' from sign-in is opaque session ID, NOT a JWT.
             Call /token endpoint to get the actual JWT.

  Endpoints:
    POST /sign-up/email     {email, password, name}   → account + session
    POST /sign-in/email     {email, password}          → session
    GET  /token             (session cookie)           → {token: "JWT..."}
    GET  /get-session       (session cookie)           → {session, user}
    GET  /.well-known/jwks.json                        → Ed25519 public key
    GET  /ok                                           → {ok: true}

  All POST endpoints require Origin header.

--- Troubleshooting ---

  "connection refused" from Modal:
    Ensure ?sslmode=require in connection string.

  "EdDSA algorithm not supported":
    Pin PyJWT[crypto]>=2.8.0 in pyproject.toml.

  "MISSING_ORIGIN":
    Auth POST requests need Origin header matching a trusted domain.

  "INVALID_CALLBACKURL" from email verification:
    Neon Auth trusted_origins must include the current Fly/Modal/custom app URL,
    not just an old deploy origin.

  Token exchange returns 401:
    The sign-in 'token' is opaque — fetch /token to get the JWT.
`,

	"config": `
=== boring.app.toml — Config Reference ===

[app]
  name       App display name
  logo       Single character or emoji
  id         URL-safe identifier (used in Vault paths and deploy app names)

[framework]
  repo       GitHub repo (e.g. "github.com/boringdata/boring-ui")
  commit     Pinned commit hash (used for deploy; ignored in dev with ../boring-ui)

[backend]
  type       "python" | "typescript" | "go"
  entry      Backend entrypoint / watch target
             - python: dotted ASGI target (e.g. "myapp.app:create_app")
             - typescript: server entry file (e.g. "src/server/index.ts")
             - go: build target for air (e.g. "." or "./cmd/server")
  port       Backend port (default: 8000)
  routers    Python-only list of dotted router paths
             (e.g. ["myapp.routers.api:router"])

[frontend]
  port       Frontend port (default: 5173)
  [frontend.branding]
    name     Display name in UI
  [frontend.features]
    agentRailMode   "all" | "pi" | "companion" | "native"
  [frontend.data]
    backend  "http" | "lightningfs" | "cheerpx"
  [frontend.panels]
    <id> = { component = "./panels/Foo.jsx", title = "Foo", placement = "left" }

[cli]
  name      Child app CLI binary on PATH (e.g. "bm")

[cli.commands]
  Legacy aliases only. Prefer bui run <args...> with [cli].name.
  <name> = { run = "cmd args", description = "..." }

[auth]
  provider        "neon" | "local" | "none"
  session_cookie  Cookie name (default: "boring_session")
  session_ttl     TTL in seconds (default: 86400)

[deploy]
  platform   "fly" | "modal" | "docker"
  env        "prod" | "staging" | "dev" (isolates Vault path and deploy target)
  [deploy.secrets]
    KEY = { vault = "secret/path", field = "field_name" }
  [deploy.neon]
    project, database, auth_url, jwks_url (populated by 'bui neon setup')
  [deploy.fly]
    org, control_plane_app, region
  [deploy.modal]
    app_name, min_containers, gpu
`,

	"auth": `
=== Auth Provider Architecture ===

boring-ui supports three auth providers, set via [auth].provider:

  local    Dev mode — query-param login, no external deps
  neon     Production — Neon Auth (Better Auth), email/password, EdDSA JWT
  none     Disable auth entirely

--- Session cookies ---

  Cookie: boring_session (or boring_session_{app_id})
  Format: HS256 JWT signed with BORING_UI_SESSION_SECRET
  Payload: {sub, email, exp, app_id}

  CRITICAL: BORING_UI_SESSION_SECRET must be stable across deploys.
  Without it, every restart invalidates all sessions.

--- Child app interop ---

  Child apps (boring-macro, boring-sandbox) validate but never issue cookies.
  Share the same secret: BORING_UI_SESSION_SECRET = BORING_SESSION_SECRET.
  Rotate boring-ui first, then all child apps.

--- Neon Auth flow ---

  Frontend → POST /auth/sign-in → boring-ui backend
    → Neon Auth /sign-in/email → session cookie
    → /token → EdDSA JWT
    → JWKS verification → boring_session cookie

  boring-ui endpoints:
    POST /auth/sign-in      Email/password sign-in
    POST /auth/sign-up      Verify-first account creation
    GET  /auth/callback      Email verification landing
    POST /auth/token-exchange  JWT-to-session fallback

--- Vault credential paths ---

  Per-app, per-env: secret/agent/app/{app-id}/{env}
  Fields: database_url, session_secret, neon_project_id, neon_branch_id
`,

	"github": `
=== GitHub App Integration ===

boring-ui integrates with GitHub via a GitHub App for workspace-level
git operations. The App provides installation tokens for per-repo access.

--- Setup ---

  1. Create a GitHub App (or use existing boring-ui-app)
  2. Store credentials in Vault:
     vault kv put secret/agent/services/boring-ui-app \
       app_id=<id> client_id=<id> client_secret=<secret> \
       pem="<private-key>" slug=<slug>

  3. Add to [deploy.secrets] in boring.app.toml:
     GITHUB_APP_ID            = { vault = "secret/agent/services/boring-ui-app", field = "app_id" }
     GITHUB_APP_CLIENT_ID     = { vault = "...", field = "client_id" }
     GITHUB_APP_CLIENT_SECRET = { vault = "...", field = "client_secret" }
     GITHUB_APP_PRIVATE_KEY   = { vault = "...", field = "pem" }
     GITHUB_APP_SLUG          = { vault = "...", field = "slug" }

--- Workspace flow ---

  Current TS route surface:
  1. App config/status checked via /api/v1/github/status
  2. OAuth URL built via /api/v1/github/oauth/initiate
  3. OAuth callback handled at /api/v1/github/oauth/callback
  4. Installations listed via /api/v1/github/installations
  5. Workspace linked via /api/v1/github/connect
  6. Installation repos listed via /api/v1/github/repos
  7. Git credentials minted via /api/v1/github/git-credentials
  8. Connection cleared via /api/v1/github/disconnect

--- API endpoints (under /api/v1/github) ---

  GET  /status           GitHub App config + optional workspace status
  GET  /oauth/initiate   Build OAuth URL + state
  GET  /oauth/callback   Handle OAuth callback
  GET  /installations    List app installations
  POST /connect          Link workspace to installation
  GET  /repos            List repos for installation
  GET  /git-credentials  Mint workspace git credentials
  POST /disconnect       Clear connection state

--- Troubleshooting ---

  "GitHub feature not enabled":
    Check GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY env vars.

  "No installations found":
    Install the app: github.com/apps/<slug>/installations/new
`,

	"smoke": `
=== Smoke Test Suite ===

Smoke tests live in tests/smoke/ and share helpers from smoke_lib/.

--- Test matrix ---

  smoke_neon_auth.py              Neon signup, verify, sign-in, session, logout
  smoke_workspace_lifecycle.py    Auth → workspace create/list/setup/runtime
  smoke_filesystem.py             File tree, write/read/rename/delete
  smoke_git_sync.py               Git init/status/commit/remotes/security
  smoke_github_connect.py         GitHub App connect/disconnect lifecycle
  smoke_settings.py               User + workspace settings CRUD
  smoke_core_mode.py              End-to-end core mode
  smoke_edge_mode.py              End-to-end edge mode

--- Recommended sequence for child app deploy ---

  1. python3 tests/smoke/smoke_neon_auth.py --base-url https://<app>
  2. python3 tests/smoke/smoke_workspace_lifecycle.py --base-url https://<app>
  3. python3 tests/smoke/smoke_filesystem.py --base-url https://<app>

--- Common flags ---

  --base-url       App origin to test
  --auth-mode      neon | supabase | dev
  --skip-signup    Reuse existing account (+ --email, --password)
  --evidence-out   Save JSON results to file
`,
}
