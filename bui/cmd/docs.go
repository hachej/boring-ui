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

  bui docs init       Scaffold a new child app
  bui docs dev        Dev server setup and framework resolution
  bui docs deploy     Build, secrets, Modal or Docker deploy workflow
  bui docs neon       Neon Postgres + Auth setup, teardown, troubleshooting
  bui docs config     boring.app.toml schema reference
  bui docs auth       Auth provider architecture and session cookies
  bui docs github     GitHub App integration setup
  bui docs smoke      Smoke test suite and recommended sequences`)
}

var docTopics = map[string]string{
	"init": `
=== bui init — Child App Scaffolding ===

  bui init <name>
  bui init --go <name>

Default Python scaffold creates:
  boring.app.toml       App config (name, backend, frontend, deploy)
  pyproject.toml        Python package definition
  src/<name>/routers/   Custom FastAPI routers (example included)
  panels/               Custom React panels
  .gitignore            Standard ignores
  .env.example          Template for local dev secrets

Go scaffold creates:
  boring.app.toml       App config with [backend].type = "go"
  go.mod / go.sum       Go module pinned to boring-ui
  main.go               Child app entrypoint with default module wiring
  hello/module.go       Example module and route
  .gitignore            Standard ignores
  .env.example          Template for local dev secrets

If ../boring-ui is present, the Go scaffold adds a local replace and runs 'go mod tidy'
so 'go build ./...' works immediately. Without a local framework sibling, init still
completes and prints the follow-up 'go get ... && go mod tidy' step.

After init:
  cd <name>
  cp .env.example .env          # add your API keys
  bui dev                       # auto-detects ../boring-ui
  bui neon setup                # provision database + auth
  bui deploy                    # build + deploy to Modal

Name must be lowercase alphanumeric with hyphens (e.g. boring-macro).
`,

	"dev": `
=== bui dev — Dev Server ===

Starts uvicorn (backend) + vite (frontend) with hot-reload.

Framework resolution (in order):
  1. ../boring-ui/ exists with boring.app.toml  → use it
  2. BUI_FRAMEWORK_PATH env var set             → use that path
  3. Neither                                    → git fetch [framework].commit to ~/.bui/cache/

What happens on start:
  - Creates .venv if needed (per-project Python isolation)
  - pip install -e <boring-ui>     (editable, instant reload)
  - pip install -e .               (child app, if pyproject.toml exists)
  - Symlinks node_modules/boring-ui → framework path
  - Reads .env for local secrets (ANTHROPIC_API_KEY, etc.)

Go backend notes:
  - backend.type = "go" requires air in PATH
  - backend.entry becomes the go build target for air
  - bui init --go writes backend.entry = "." so bui dev builds the app root

Flags:
  --backend-only      Only uvicorn (attach debugger separately)
  --frontend-only     Only vite (use browser DevTools)
  --port N            Override backend port
  --vite-port N       Override frontend port

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
  modal    Run 'modal deploy' with resolved env vars
  docker   Build + push image, copy compose/Caddy assets, restart remote Docker Compose over SSH

Environment isolation (--env flag):
  --env prod      Vault: secret/agent/app/{id}/prod     Modal: {app_name}
  --env staging   Vault: secret/agent/app/{id}/staging  Modal: {app_name}-staging
  --env dev       Vault: secret/agent/app/{id}/dev      Modal: {app_name}-dev

Prerequisites:
  - Vault accessible (VAULT_ADDR + VAULT_TOKEN)
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
  3. Runs control-plane schema (deploy/sql/control_plane_supabase_schema.sql)
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

  Token exchange returns 401:
    The sign-in 'token' is opaque — fetch /token to get the JWT.
`,

	"config": `
=== boring.app.toml — Config Reference ===

[app]
  name       App display name
  logo       Single character or emoji
  id         URL-safe identifier (used in Vault paths, Modal app names)

[framework]
  repo       GitHub repo (e.g. "github.com/boringdata/boring-ui")
  commit     Pinned commit hash (used for deploy; ignored in dev with ../boring-ui)

[backend]
  entry      Python entry point (e.g. "myapp.app:create_app")
  port       Backend port (default: 8000)
  routers    List of Python dotted paths (e.g. ["myapp.routers.api:router"])

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
  platform   "modal" | "docker"
  env        "prod" | "staging" | "dev" (isolates Vault path + Modal app name)
  [deploy.secrets]
    KEY = { vault = "secret/path", field = "field_name" }
  [deploy.neon]
    project, database, auth_url, jwks_url (populated by 'bui neon setup')
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

  1. User links GitHub account (OAuth)
  2. App installation verified for user's account/org
  3. Workspace bound to one installation
  4. Repo selected for workspace
  5. In pi-lightningfs mode, repo bootstrapped into browser workspace

--- API endpoints (under /api/v1/auth/github) ---

  GET  /status          Config + connection state
  GET  /authorize       Start OAuth flow
  GET  /callback        Handle OAuth callback
  POST /connect         Connect workspace to installation
  POST /repo            Select repo for workspace
  POST /disconnect      Disconnect workspace
  GET  /installations   List available installations
  GET  /repos           List repos for installation
  GET  /git-credentials Get installation token

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
