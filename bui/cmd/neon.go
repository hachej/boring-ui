package cmd

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/boringdata/boring-ui/bui/config"
	vaultpkg "github.com/boringdata/boring-ui/bui/vault"
	"github.com/spf13/cobra"
)

var (
	neonRegion        string
	neonProjectName   string
	neonEnv           string
	neonEmailProvider string
)

var neonCmd = &cobra.Command{
	Use:   "neon",
	Short: "Neon database management",
	Long: `Manage Neon Postgres + Neon Auth for this app.

Run 'bui docs neon' for the full Neon setup guide.`,
}

var neonSetupCmd = &cobra.Command{
	Use:   "setup",
	Short: "Provision Neon project + DB + auth, update boring.app.toml",
	Long: `Provision Neon project, run schema, enable auth, store creds in Vault.
Requires Neon API key at: vault kv put secret/agent/neon api_key=<key>

Run 'bui docs neon' for prerequisites and the full setup guide.`,
	RunE: runNeonSetup,
}

var neonStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Check Neon connection and auth health",
	RunE:  runNeonStatus,
}

var neonDestroyForce bool

var neonDestroyCmd = &cobra.Command{
	Use:   "destroy",
	Short: "Delete Neon project, clean Vault secrets, reset config",
	Long: `Delete Neon project, clean Vault secrets, reset boring.app.toml.
Use --force to skip the confirmation prompt.`,
	RunE: runNeonDestroy,
}

func init() {
	neonSetupCmd.Flags().StringVar(&neonRegion, "region", "aws-eu-central-1", "Neon region")
	neonSetupCmd.Flags().StringVar(&neonProjectName, "name", "", "Project name (defaults to app name)")
	neonSetupCmd.Flags().StringVar(&neonEnv, "env", "", "Override deploy environment (default from config)")
	neonSetupCmd.Flags().StringVar(&neonEmailProvider, "email-provider", "", "Override email provider (default: auto-detect from Vault)")
	neonSetupCmd.Flags().MarkHidden("email-provider")
	neonDestroyCmd.Flags().BoolVar(&neonDestroyForce, "force", false, "Skip confirmation prompt")
	neonDestroyCmd.Flags().StringVar(&neonEnv, "env", "", "Override deploy environment (default from config)")
	neonCmd.AddCommand(neonSetupCmd)
	neonCmd.AddCommand(neonStatusCmd)
	neonCmd.AddCommand(neonDestroyCmd)
}

// --- Neon API types ---

type neonProject struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type neonEndpoint struct {
	ID   string `json:"id"`
	Host string `json:"host"`
}

type neonDatabase struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Owner string `json:"owner_name"`
}

type neonRole struct {
	Name     string `json:"name"`
	Password string `json:"password"`
}

type neonBranch struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type neonCreateResponse struct {
	Project        neonProject    `json:"project"`
	Endpoints      []neonEndpoint `json:"endpoints"`
	Databases      []neonDatabase `json:"databases"`
	Roles          []neonRole     `json:"roles"`
	Branch         neonBranch     `json:"branch"`
	ConnectionURIs []struct {
		ConnectionURI string `json:"connection_uri"`
	} `json:"connection_uris"`
}

type neonAuthResponse struct {
	BaseURL         string `json:"base_url"`
	JWKSURL         string `json:"jwks_url"`
	PubClientKey    string `json:"pub_client_key"`
	SecretServerKey string `json:"secret_server_key"`
}

// --- Implementation ---

func runNeonSetup(cmd *cobra.Command, args []string) error {
	cfg, root := config.MustLoad()
	if neonEnv != "" {
		cfg.Deploy.Env = neonEnv
	}

	// Check if already configured
	if cfg.Deploy.Neon.Project != "" {
		return fmt.Errorf("Neon already configured (project=%s). Delete the project first or remove [deploy.neon] config", cfg.Deploy.Neon.Project)
	}

	// 1. Get Neon API key from Vault
	fmt.Println("[bui] fetching Neon API key from Vault...")
	apiKey, err := vaultpkg.Get("secret/agent/neon", "api_key")
	if err != nil {
		return fmt.Errorf("vault: %w (store your Neon API key at secret/agent/neon:api_key)", err)
	}

	projectName := neonProjectName
	if projectName == "" {
		projectName = cfg.App.Name
	}

	// 2. Create Neon project
	fmt.Printf("[bui] creating Neon project %q in %s...\n", projectName, neonRegion)
	createResp, err := neonCreateProject(apiKey, projectName, neonRegion)
	if err != nil {
		return fmt.Errorf("create project: %w", err)
	}

	projectID := createResp.Project.ID
	branchID := createResp.Branch.ID
	fmt.Printf("  project: %s\n", projectID)
	fmt.Printf("  branch:  %s\n", branchID)

	// Build connection URLs
	var directURL, poolerURL string
	if len(createResp.ConnectionURIs) > 0 {
		directURL = createResp.ConnectionURIs[0].ConnectionURI
	}

	// Build pooler URL from endpoint host
	// Direct: ep-xxx.c-N.region.aws.neon.tech
	// Pooler: ep-xxx-pooler.c-N.region.aws.neon.tech
	if len(createResp.Endpoints) > 0 && len(createResp.Roles) > 0 {
		ep := createResp.Endpoints[0]
		role := createResp.Roles[0]
		dbName := "neondb"
		if len(createResp.Databases) > 0 {
			dbName = createResp.Databases[0].Name
		}
		// Insert -pooler after the endpoint name (first segment before '.')
		dotIdx := strings.Index(ep.Host, ".")
		poolerHost := ep.Host
		if dotIdx > 0 {
			poolerHost = ep.Host[:dotIdx] + "-pooler" + ep.Host[dotIdx:]
		}
		poolerURL = fmt.Sprintf("postgresql://%s:%s@%s/%s?sslmode=require",
			role.Name, role.Password, poolerHost, dbName)
		if directURL == "" {
			directURL = fmt.Sprintf("postgresql://%s:%s@%s/%s?sslmode=require",
				role.Name, role.Password, ep.Host, dbName)
		}
	}

	fmt.Printf("  database URL: %s\n", maskPassword(poolerURL))

	// 3. Run schema — apply base schema + all numbered migrations
	fmt.Println("[bui] running database schema...")
	dbURL := directURL
	if dbURL == "" {
		dbURL = poolerURL
	}
	frameworkRoot, _ := detectFrameworkRepo()
	sqlFiles := collectNeonSchemaFiles(root, frameworkRoot)
	if len(sqlFiles) == 0 {
		fmt.Println("  warn: no schema files found under app or framework roots")
	}
	for _, sf := range sqlFiles {
		psql := exec.Command("psql", dbURL, "-f", sf)
		psql.Stdout = os.Stdout
		psql.Stderr = os.Stderr
		if err := psql.Run(); err != nil {
			fmt.Printf("  warn: %s failed: %v\n", filepath.Base(sf), err)
		} else {
			fmt.Printf("  ✓ %s applied\n", filepath.Base(sf))
		}
	}

	// 4. Enable Neon Auth
	fmt.Println("[bui] enabling Neon Auth...")
	// Wait a moment for the project to be fully ready
	time.Sleep(2 * time.Second)
	trustedOrigins := defaultNeonTrustedOrigins(cfg.App.ID)
	fmt.Printf("[bui] seeding auth trusted origins: %s\n", strings.Join(trustedOrigins, ", "))
	authResp, err := neonEnableAuth(apiKey, projectID, branchID, trustedOrigins)
	if err != nil {
		return fmt.Errorf("enable auth: %w", err)
	}
	if err := neonSeedAuthRedirectDomains(apiKey, projectID, branchID, trustedOrigins); err != nil {
		return fmt.Errorf("seed auth callback domains: %w", err)
	}
	fmt.Printf("  auth URL: %s\n", authResp.BaseURL)
	fmt.Printf("  JWKS URL: %s\n", authResp.JWKSURL)
	fmt.Println("  ✓ trusted origins and callback domains provisioned with auth")

	// 5. Configure email provider.
	// Auto-detect: if Resend API key is in Vault, use it. Override with --email-provider flag.
	emailProvider := neonEmailProvider
	if emailProvider == "" {
		// Auto-detect from Vault
		_, resendErr := vaultpkg.Get("secret/agent/services/resend", "api_key")
		if resendErr == nil {
			emailProvider = "resend"
			fmt.Println("[bui] auto-detected Resend API key in Vault")
		} else {
			fmt.Println("[bui] no email provider detected (Resend key not in Vault)")
			fmt.Println("  Verification emails will not be sent.")
			fmt.Println("  To enable: vault kv put secret/agent/services/resend api_key=re_...")
		}
	}
	if emailProvider != "" && emailProvider != "none" {
		configureEmailProvider(apiKey, projectID, emailProvider, cfg.App.Name)
	}

	// 5b. Set email verification to link mode (requires custom email provider).
	// Default Neon Auth projects use OTP codes; link mode sends a clickable
	// verification URL which our /auth/callback handler expects.
	fmt.Println("[bui] setting email verification to link mode...")
	if err := neonSetEmailVerificationMethod(apiKey, projectID, branchID, "link"); err != nil {
		fmt.Printf("  warn: could not set verification method: %v\n", err)
		fmt.Println("  Set manually in Neon Console → Settings → Auth → Verification method → Link")
	} else {
		fmt.Println("  ✓ email verification method set to link")
	}

	// 6. Generate session secret + settings key
	sessionSecret := generateRandomHex(32)
	settingsKey := generateRandomHex(32)

	// 7. Store credentials in Vault (per-app, per-env isolation)
	vaultPath := cfg.AppVaultPath()
	vaultData := map[string]string{
		"database_url":        poolerURL,
		"database_direct_url": directURL,
		"session_secret":      sessionSecret,
		"settings_key":        settingsKey,
		"neon_project_id":     projectID,
		"neon_branch_id":      branchID,
	}

	fmt.Printf("[bui] storing credentials in Vault (%s)...\n", vaultPath)
	if err := vaultpkg.Put(vaultPath, vaultData); err != nil {
		// Vault write failed (likely read-only token) — fall back to local file
		fmt.Printf("  warn: Vault write failed: %v\n", err)
		fmt.Println("  falling back to .boring/neon-config.env")

		boringDir := filepath.Join(root, ".boring")
		os.MkdirAll(boringDir, 0o700)
		envContent := fmt.Sprintf(
			"NEON_PROJECT_ID=%s\nNEON_BRANCH_ID=%s\nDATABASE_URL=%s\nDATABASE_POOLER_URL=%s\nNEON_AUTH_BASE_URL=%s\nNEON_AUTH_JWKS_URL=%s\nBORING_UI_SESSION_SECRET=%s\nBORING_SETTINGS_KEY=%s\n",
			projectID, branchID, directURL, poolerURL, authResp.BaseURL, authResp.JWKSURL, sessionSecret, settingsKey,
		)
		envFile := filepath.Join(boringDir, "neon-config.env")
		if err := os.WriteFile(envFile, []byte(envContent), 0o600); err != nil {
			return fmt.Errorf("write neon-config.env: %w", err)
		}
		fmt.Printf("  saved: %s\n", envFile)
		fmt.Println()
		fmt.Println("  To store in Vault manually (recommended):")
		fmt.Printf("    vault kv put %s \\\n", vaultPath)
		fmt.Printf("      database_url=%q \\\n", maskPassword(poolerURL))
		fmt.Printf("      database_direct_url=%q \\\n", maskPassword(directURL))
		fmt.Printf("      session_secret=%q \\\n", sessionSecret)
		fmt.Printf("      settings_key=%q \\\n", settingsKey)
		fmt.Printf("      neon_project_id=%q \\\n", projectID)
		fmt.Printf("      neon_branch_id=%q\n", branchID)
	} else {
		fmt.Printf("  ✓ credentials stored at %s\n", vaultPath)
	}

	// 8. Update boring.app.toml
	fmt.Println("[bui] updating boring.app.toml...")
	if err := updateTomlNeonConfig(root, projectID, cfg.AppVaultPath(), authResp); err != nil {
		return fmt.Errorf("update config: %w", err)
	}

	fmt.Println()
	fmt.Println("[bui] Neon setup complete!")
	fmt.Println()
	fmt.Println("Next steps:")
	for _, line := range neonSetupNextSteps(emailProvider != "" && emailProvider != "none") {
		fmt.Println(line)
	}
	return nil
}

func runNeonStatus(cmd *cobra.Command, args []string) error {
	cfg, root := config.MustLoad()

	if cfg.Deploy.Neon.Project == "" {
		fmt.Println("[bui] Neon not configured. Run `bui neon setup` first.")
		return nil
	}

	// Resolve DB URL: try Vault first, then .boring/neon-config.env
	appVaultPath := cfg.AppVaultPath()
	dbURL, _ := vaultpkg.Get(appVaultPath, "database_url")
	if dbURL == "" {
		dbURL = loadNeonEnvField(root, "DATABASE_POOLER_URL")
	}

	fmt.Printf("Project:  %s\n", cfg.Deploy.Neon.Project)
	fmt.Printf("Database: %s\n", cfg.Deploy.Neon.Database)
	fmt.Printf("Auth URL: %s\n", cfg.Deploy.Neon.AuthURL)
	fmt.Printf("JWKS URL: %s\n", cfg.Deploy.Neon.JWKSURL)
	fmt.Printf("DB URL:   %s\n", maskPassword(dbURL))

	// Check JWKS endpoint
	fmt.Print("\nJWKS health: ")
	if cfg.Deploy.Neon.JWKSURL != "" {
		resp, err := http.Get(cfg.Deploy.Neon.JWKSURL)
		if err != nil {
			fmt.Printf("FAIL (%v)\n", err)
		} else {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				fmt.Println("OK")
			} else {
				fmt.Printf("FAIL (HTTP %d)\n", resp.StatusCode)
			}
		}
	} else {
		fmt.Println("not configured")
	}

	// Check auth /ok endpoint
	fmt.Print("Auth health: ")
	if cfg.Deploy.Neon.AuthURL != "" {
		resp, err := http.Get(cfg.Deploy.Neon.AuthURL + "/ok")
		if err != nil {
			fmt.Printf("FAIL (%v)\n", err)
		} else {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				fmt.Println("OK")
			} else {
				fmt.Printf("FAIL (HTTP %d)\n", resp.StatusCode)
			}
		}
	} else {
		fmt.Println("not configured")
	}

	// Check DB connectivity
	fmt.Print("DB health:   ")
	if dbURL != "" {
		psql := exec.Command("psql", dbURL, "-c", "SELECT 1")
		psql.Stdout = io.Discard
		psql.Stderr = io.Discard
		if err := psql.Run(); err != nil {
			fmt.Printf("FAIL (%v)\n", err)
		} else {
			fmt.Println("OK")
		}
	} else {
		fmt.Println("not configured (not in Vault or .boring/)")
	}

	return nil
}

func runNeonDestroy(cmd *cobra.Command, args []string) error {
	cfg, root := config.MustLoad()
	if neonEnv != "" {
		cfg.Deploy.Env = neonEnv
	}

	projectID := cfg.Deploy.Neon.Project
	if projectID == "" {
		return fmt.Errorf("no Neon project configured. Nothing to destroy")
	}

	vaultPath := cfg.AppVaultPath()

	// Confirmation
	if !neonDestroyForce {
		fmt.Printf("This will permanently destroy:\n")
		fmt.Printf("  Neon project: %s\n", projectID)
		fmt.Printf("  Vault path:   %s\n", vaultPath)
		fmt.Printf("  Local file:   .boring/neon-config.env\n")
		fmt.Printf("\nType the project ID to confirm: ")
		var confirm string
		fmt.Scanln(&confirm)
		if strings.TrimSpace(confirm) != projectID {
			return fmt.Errorf("confirmation failed (expected %q, got %q)", projectID, confirm)
		}
	}

	// 1. Get Neon API key
	fmt.Println("[bui] fetching Neon API key from Vault...")
	apiKey, err := vaultpkg.Get("secret/agent/neon", "api_key")
	if err != nil {
		return fmt.Errorf("vault: %w", err)
	}

	// 2. Delete Neon project
	fmt.Printf("[bui] deleting Neon project %s...\n", projectID)
	_, err = neonAPI("DELETE", "/projects/"+projectID, apiKey, nil)
	if err != nil {
		fmt.Printf("  warn: Neon API delete failed: %v\n", err)
		fmt.Println("  (project may already be deleted — continuing cleanup)")
	} else {
		fmt.Println("  project deleted")
	}

	// 3. Clean Vault
	fmt.Printf("[bui] cleaning Vault path %s...\n", vaultPath)
	if err := vaultpkg.Delete(vaultPath); err != nil {
		fmt.Printf("  warn: Vault cleanup failed: %v\n", err)
	} else {
		fmt.Println("  Vault path deleted")
	}

	// 4. Remove .boring/neon-config.env
	envFile := filepath.Join(root, ".boring", "neon-config.env")
	if _, err := os.Stat(envFile); err == nil {
		os.Remove(envFile)
		fmt.Printf("  removed %s\n", envFile)
	}

	// Also remove session-secret file
	secretFile := filepath.Join(root, ".boring", "session-secret")
	if _, err := os.Stat(secretFile); err == nil {
		os.Remove(secretFile)
		fmt.Printf("  removed %s\n", secretFile)
	}

	// 5. Reset boring.app.toml
	fmt.Println("[bui] resetting boring.app.toml...")
	if err := resetTomlNeonConfig(root); err != nil {
		return fmt.Errorf("reset config: %w", err)
	}

	fmt.Println()
	fmt.Println("[bui] Neon teardown complete.")
	fmt.Println("  Run `bui neon setup` to provision a new project.")
	return nil
}

func resetTomlNeonConfig(root string) error {
	cfg, err := config.Load(root)
	if err != nil {
		return err
	}
	tomlPath := filepath.Join(root, config.ConfigFile)
	data, err := os.ReadFile(tomlPath)
	if err != nil {
		return err
	}
	content := string(data)

	// Reset auth provider to local
	content = replaceTomlLine(content, `provider = "neon"`, `provider = "local"`)

	// Reset [deploy.neon] section
	content = replaceTomlSection(content, "[deploy.neon]", `[deploy.neon]
# Populated by 'bui neon setup'`)

	// Preserve existing shared secret refs and drop only Neon-managed app secrets.
	content = replaceTomlSection(content, "[deploy.secrets]", renderDeploySecretsSection(dropNeonManagedDeploySecrets(cfg.Deploy.Secrets)))

	return os.WriteFile(tomlPath, []byte(content), 0o644)
}

func configureEmailProvider(apiKey, projectID, provider, appName string) {
	fmt.Println("[bui] configuring email provider...")

	switch strings.ToLower(provider) {
	case "resend":
		// Get Resend API key from Vault
		resendKey, err := vaultpkg.Get("secret/agent/services/resend", "api_key")
		if err != nil {
			fmt.Printf("  warn: could not fetch Resend API key from Vault: %v\n", err)
			fmt.Println("  Store it at: vault kv put secret/agent/services/resend api_key=re_...")
			return
		}
		fmt.Println("  ✓ Resend API key found in Vault")

		// Configure SMTP via Neon API
		senderName := appName
		if senderName == "" {
			senderName = "Boring UI"
		}
		err = neonConfigureEmailServer(apiKey, projectID, map[string]interface{}{
			"type":         "standard",
			"host":         "smtp.resend.com",
			"port":         465,
			"username":     "resend",
			"password":     resendKey,
			"sender_email": "auth@mail.boringdata.io",
			"sender_name":  senderName,
		})
		if err != nil {
			fmt.Printf("  warn: Neon API email config failed: %v\n", err)
			fmt.Println("  Configure manually in Neon Console:")
			fmt.Printf("  https://console.neon.tech/app/projects/%s/settings/auth\n", projectID)
			return
		}
		fmt.Println("  ✓ Resend SMTP configured via Neon API")

	case "smtp":
		fmt.Println("  Configure custom SMTP in Neon Console:")
		fmt.Printf("  https://console.neon.tech/app/projects/%s/settings/auth\n", projectID)
		fmt.Println()
		fmt.Println("  Required fields: Host, Port, Username, Password, Sender email, Sender name")

	case "none", "":
		fmt.Println("  Skipping email provider (verification emails disabled)")

	default:
		fmt.Printf("  Unknown email provider: %q (supported: resend, smtp, none)\n", provider)
	}
}

func defaultNeonTrustedOrigins(appID string) []string {
	origins := []string{fmt.Sprintf("https://%s.fly.dev", appID)}
	// Neon rejects explicit localhost entries via the auth API, so seed the
	// canonical loopback IP origins that we use for repeatable local callbacks.
	for _, port := range []string{"3000", "5173", "5174", "5175", "5176"} {
		origins = append(origins, fmt.Sprintf("http://127.0.0.1:%s", port))
	}
	return origins
}

func collectNeonSchemaFiles(root, frameworkRoot string) []string {
	searchRoots := []string{}
	addRoot := func(candidate string) {
		if candidate == "" {
			return
		}
		absCandidate, err := filepath.Abs(candidate)
		if err != nil {
			absCandidate = candidate
		}
		for _, existing := range searchRoots {
			if existing == absCandidate {
				return
			}
		}
		searchRoots = append(searchRoots, absCandidate)
	}

	addRoot(frameworkRoot)
	addRoot(root)

	files := []string{}
	seen := map[string]struct{}{}
	addFile := func(path string) {
		if _, ok := seen[path]; ok {
			return
		}
		if _, err := os.Stat(path); err != nil {
			return
		}
		seen[path] = struct{}{}
		files = append(files, path)
	}

	for _, base := range searchRoots {
		sqlDir := filepath.Join(base, "deploy", "sql")
		entries, err := os.ReadDir(sqlDir)
		if err == nil {
			for _, e := range entries {
				if e.IsDir() || filepath.Ext(e.Name()) != ".sql" {
					continue
				}
				addFile(filepath.Join(sqlDir, e.Name()))
			}
		}
		if err != nil || len(entries) == 0 {
			addFile(filepath.Join(base, "internal", "db", "testdata", "control_plane_schema.sql"))
		}
	}

	return files
}

func neonSetupNextSteps(emailConfigured bool) []string {
	if !emailConfigured {
		return []string{
			"  1. Configure a custom SMTP provider in Neon Console if you need verification emails",
			"     Neon Console → Settings → Auth → Custom SMTP provider",
			"  2. Run `bui deploy` to deploy with Neon auth",
			"  3. Visit your app and test signup/signin",
			"  4. Run `bui neon status` to verify health",
		}
	}
	return []string{
		"  1. Run `bui deploy` to deploy with Neon auth",
		"  2. Visit your app and test signup/signin",
		"  3. Run `bui neon status` to verify health",
	}
}

// neonSetTrustedOrigins adds origins to the Neon Auth trusted_origins list.
// trusted_origins must be supplied when Neon Auth is created.
// Neon exposes POST /projects/{project_id}/branches/{branch_id}/auth for this,
// and follow-up updates are not supported by the same branch endpoint.
func neonAuthCreatePayload(origins []string) map[string]interface{} {
	payload := map[string]interface{}{
		"auth_provider": "better_auth",
	}
	if len(origins) > 0 {
		payload["trusted_origins"] = origins
	}
	return payload
}

func neonAuthTrustedDomainPayload(origin string) map[string]interface{} {
	return map[string]interface{}{
		"auth_provider": "better_auth",
		"domain":        origin,
	}
}

// neonSetEmailVerificationMethod sets the email verification method (link or otp).
// PATCH /projects/{project_id}/branches/{branch_id}/auth/email_and_password
func neonSetEmailVerificationMethod(apiKey, projectID, branchID, method string) error {
	path := fmt.Sprintf("/projects/%s/branches/%s/auth/email_and_password", projectID, branchID)
	_, err := neonAPI("PATCH", path, apiKey, map[string]interface{}{
		"email_verification_method": method,
	})
	return err
}

// neonConfigureEmailServer sets the email server config via Neon API.
// PATCH /projects/{project_id}/auth/email_server
func neonConfigureEmailServer(apiKey, projectID string, config map[string]interface{}) error {
	path := fmt.Sprintf("/projects/%s/auth/email_server", projectID)
	_, err := neonAPI("PATCH", path, apiKey, config)
	return err
}

// --- Neon API helpers ---

func neonAPI(method, path, apiKey string, body interface{}) ([]byte, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(data)
	}

	url := "https://console.neon.tech/api/v2" + path
	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, &neonAPIHTTPError{
			StatusCode: resp.StatusCode,
			Body:       string(respBody),
		}
	}

	return respBody, nil
}

func neonCreateProject(apiKey, name, region string) (*neonCreateResponse, error) {
	payload := map[string]interface{}{
		"project": map[string]interface{}{
			"name":      name,
			"region_id": region,
		},
	}

	data, err := neonAPI("POST", "/projects", apiKey, payload)
	if err != nil {
		return nil, err
	}

	var resp neonCreateResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("parse response: %w\n%s", err, string(data))
	}
	return &resp, nil
}

type neonAPIHTTPError struct {
	StatusCode int
	Body       string
}

func (e *neonAPIHTTPError) Error() string {
	return fmt.Sprintf("HTTP %d: %s", e.StatusCode, e.Body)
}

func neonEnableAuth(apiKey, projectID, branchID string, origins []string) (*neonAuthResponse, error) {
	payload := neonAuthCreatePayload(origins)
	path := fmt.Sprintf("/projects/%s/branches/%s/auth", projectID, branchID)
	data, err := neonAPI("POST", path, apiKey, payload)
	if err != nil {
		return nil, err
	}

	var resp neonAuthResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("parse auth response: %w\n%s", err, string(data))
	}
	return &resp, nil
}

func neonSeedAuthRedirectDomains(apiKey, projectID, branchID string, origins []string) error {
	path := fmt.Sprintf("/projects/%s/branches/%s/auth/domains", projectID, branchID)
	for _, origin := range origins {
		if strings.TrimSpace(origin) == "" {
			continue
		}
		if _, err := neonAPI("POST", path, apiKey, neonAuthTrustedDomainPayload(origin)); err != nil {
			if neonIsDomainAlreadyExistsError(err) {
				continue
			}
			return fmt.Errorf("%s: %w", origin, err)
		}
	}
	return nil
}

func neonIsDomainAlreadyExistsError(err error) bool {
	var httpErr *neonAPIHTTPError
	if !errors.As(err, &httpErr) {
		return false
	}
	return httpErr.StatusCode == http.StatusBadRequest && strings.Contains(httpErr.Body, "DOMAIN_ALREADY_EXISTS")
}

// --- Config update helpers ---

func generateRandomHex(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	return hex.EncodeToString(buf)
}

func updateTomlNeonConfig(root, projectID, appVaultPath string, auth *neonAuthResponse) error {
	cfg, err := config.Load(root)
	if err != nil {
		return err
	}
	tomlPath := filepath.Join(root, config.ConfigFile)
	data, err := os.ReadFile(tomlPath)
	if err != nil {
		return err
	}
	content := string(data)

	// Update auth provider
	content = replaceTomlLine(content, `provider = "local"`, `provider = "neon"`)

	// Update [deploy.neon] section (no credentials — those are in Vault)
	content = replaceTomlSection(content, "[deploy.neon]", fmt.Sprintf(`[deploy.neon]
project      = %q
database     = "neondb"
auth_url     = %q
jwks_url     = %q`,
		projectID, auth.BaseURL, auth.JWKSURL))

	// Update only the Neon-managed app secrets and preserve existing shared refs.
	content = replaceTomlSection(content, "[deploy.secrets]", renderDeploySecretsSection(mergeNeonManagedDeploySecrets(cfg.Deploy.Secrets, appVaultPath)))

	return os.WriteFile(tomlPath, []byte(content), 0o644)
}

func mergeNeonManagedDeploySecrets(existing map[string]config.SecretRef, appVaultPath string) map[string]config.SecretRef {
	merged := map[string]config.SecretRef{
		"DATABASE_URL":             {Vault: appVaultPath, Field: "database_url"},
		"BORING_UI_SESSION_SECRET": {Vault: appVaultPath, Field: "session_secret"},
		"BORING_SETTINGS_KEY":      {Vault: appVaultPath, Field: "settings_key"},
	}
	for name, ref := range existing {
		if _, managed := merged[name]; managed {
			continue
		}
		merged[name] = ref
	}
	return merged
}

func dropNeonManagedDeploySecrets(existing map[string]config.SecretRef) map[string]config.SecretRef {
	filtered := map[string]config.SecretRef{}
	for name, ref := range existing {
		switch name {
		case "DATABASE_URL", "BORING_UI_SESSION_SECRET", "BORING_SETTINGS_KEY":
			continue
		default:
			filtered[name] = ref
		}
	}
	return filtered
}

func renderDeploySecretsSection(refs map[string]config.SecretRef) string {
	if len(refs) == 0 {
		return `[deploy.secrets]
# Populated by 'bui neon setup'`
	}

	preferred := []string{
		"DATABASE_URL",
		"BORING_UI_SESSION_SECRET",
		"BORING_SETTINGS_KEY",
	}
	ordered := make([]string, 0, len(refs))
	seen := map[string]struct{}{}
	for _, name := range preferred {
		if _, ok := refs[name]; ok {
			ordered = append(ordered, name)
			seen[name] = struct{}{}
		}
	}

	extras := make([]string, 0, len(refs))
	for name := range refs {
		if _, ok := seen[name]; ok {
			continue
		}
		extras = append(extras, name)
	}
	sort.Strings(extras)
	ordered = append(ordered, extras...)

	lines := []string{"[deploy.secrets]"}
	for _, name := range ordered {
		ref := refs[name]
		lines = append(lines, fmt.Sprintf(`%s = { vault = %q, field = %q }`, padDeploySecretName(name), ref.Vault, ref.Field))
	}
	return strings.Join(lines, "\n")
}

func padDeploySecretName(name string) string {
	const width = 25
	if len(name) >= width {
		return name
	}
	return name + strings.Repeat(" ", width-len(name))
}

func replaceTomlLine(content, old, new string) string {
	// Try exact match first
	if strings.Contains(content, old) {
		return strings.Replace(content, old, new, 1)
	}
	// Handle whitespace-padded TOML values (e.g. "provider       = " vs "provider = ")
	oldKey := strings.SplitN(old, "=", 2)
	if len(oldKey) == 2 {
		// Build a regex-like prefix match: key with any whitespace around =
		prefix := strings.TrimSpace(oldKey[0])
		for _, line := range strings.Split(content, "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, prefix) && strings.Contains(trimmed, "=") {
				parts := strings.SplitN(trimmed, "=", 2)
				if strings.TrimSpace(parts[0]) == prefix && strings.TrimSpace(parts[1]) == strings.TrimSpace(oldKey[1]) {
					return strings.Replace(content, line, new, 1)
				}
			}
		}
	}
	return content
}

func replaceTomlSection(content, header, replacement string) string {
	idx := strings.Index(content, header)
	if idx < 0 {
		// Section not found — append it
		return content + "\n" + replacement + "\n"
	}

	// Find the end of this section (next [section] or EOF)
	rest := content[idx+len(header):]
	endIdx := -1
	lines := strings.Split(rest, "\n")
	offset := 0
	for i, line := range lines {
		if i == 0 {
			offset += len(line) + 1
			continue
		}
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[") && !strings.HasPrefix(trimmed, "[[") {
			endIdx = offset
			break
		}
		offset += len(line) + 1
	}

	if endIdx < 0 {
		// Section goes to EOF
		return content[:idx] + replacement + "\n"
	}

	return content[:idx] + replacement + "\n\n" + content[idx+len(header)+endIdx:]
}

func maskPassword(url string) string {
	// Replace password in postgresql:// URL
	if !strings.Contains(url, "://") {
		return url
	}
	parts := strings.SplitN(url, "://", 2)
	if len(parts) != 2 {
		return url
	}
	rest := parts[1]
	atIdx := strings.Index(rest, "@")
	if atIdx < 0 {
		return url
	}
	userPart := rest[:atIdx]
	colonIdx := strings.Index(userPart, ":")
	if colonIdx < 0 {
		return url
	}
	return parts[0] + "://" + userPart[:colonIdx] + ":***@" + rest[atIdx+1:]
}
