package cmd

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/boringdata/boring-ui/bui/config"
	"github.com/boringdata/boring-ui/bui/framework"
	vaultpkg "github.com/boringdata/boring-ui/bui/vault"
	"github.com/spf13/cobra"
)

var (
	deploySkipBuild bool
	deployEnv       string
	deployDryRun    bool
)

var deployCmd = &cobra.Command{
	Use:   "deploy",
	Short: "Build frontend, resolve secrets, deploy to target platform",
	Long: `Build frontend, resolve Vault secrets, deploy to the configured platform.
Platform is set in boring.app.toml [deploy] platform = "fly" | "modal" | "docker".
Use --env to target staging/dev. Use --dry-run to preview without executing.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, root := config.MustLoad()
		if deployEnv != "" {
			cfg.Deploy.Env = deployEnv
		}

		// Route to platform-specific deploy handler
		platform := cfg.Deploy.Platform
		if platform == "" {
			platform = "modal" // legacy default
		}
		switch platform {
		case "fly":
			return deployFly(cfg, root)
		case "docker":
			return deployDocker(cfg, root)
		case "modal":
			return deployModal(cfg, root)
		default:
			return fmt.Errorf("unsupported deploy platform: %s", platform)
		}
	},
}

func findFlyBinary() (string, error) {
	for _, candidate := range flyBinaryCandidates() {
		if candidate == "" {
			continue
		}
		if path, err := resolveExecutable(candidate); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("fly CLI not found (checked FLYCTL_BIN, PATH, and ~/.fly/bin/{fly,flyctl})")
}

func flyBinaryCandidates() []string {
	candidates := []string{}
	if fromEnv := strings.TrimSpace(os.Getenv("FLYCTL_BIN")); fromEnv != "" {
		candidates = append(candidates, fromEnv)
	}
	candidates = append(candidates, "fly", "flyctl")
	if home, err := os.UserHomeDir(); err == nil && strings.TrimSpace(home) != "" {
		candidates = append(candidates,
			filepath.Join(home, ".fly", "bin", "fly"),
			filepath.Join(home, ".fly", "bin", "flyctl"),
		)
	}
	return candidates
}

func resolveExecutable(candidate string) (string, error) {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return "", fmt.Errorf("empty executable candidate")
	}

	if strings.HasPrefix(candidate, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		candidate = filepath.Join(home, candidate[2:])
	} else if strings.HasPrefix(candidate, "$HOME/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		candidate = filepath.Join(home, candidate[len("$HOME/"):])
	}

	if strings.Contains(candidate, string(os.PathSeparator)) {
		info, err := os.Stat(candidate)
		if err != nil {
			return "", err
		}
		if info.Mode().IsRegular() && info.Mode()&0o111 != 0 {
			return candidate, nil
		}
		return "", fmt.Errorf("candidate is not executable: %s", candidate)
	}

	return exec.LookPath(candidate)
}

func deployFly(cfg *config.AppConfig, root string) error {
	fly := cfg.Deploy.Fly
	appName := fly.ControlPlaneApp
	if appName == "" {
		appName = cfg.App.ID
	}

	// 1. Safety: warn if local boring-ui differs from pin
	checkFrameworkDrift(cfg)

	// 2. Build frontend
	if !deploySkipBuild {
		fmt.Println("[bui] building frontend...")
		if err := buildFrontend(cfg, root); err != nil {
			return fmt.Errorf("build: %w", err)
		}
	}

	// 3. Resolve secrets from Vault
	fmt.Println("[bui] resolving secrets from Vault...")
	secrets, failed := vaultpkg.ResolveSecrets(cfg.Deploy.Secrets)
	fallbackSources, failed, err := applyNeonFallbackSecrets(root, cfg.Deploy.Secrets, secrets, failed)
	if err != nil {
		return err
	}
	for _, name := range sortedKeys(secrets) {
		if source, ok := fallbackSources[name]; ok {
			fmt.Printf("  ✓ %s (fallback: %s)\n", name, source)
			continue
		}
		fmt.Printf("  ✓ %s\n", name)
	}
	for _, name := range failed {
		fmt.Printf("  ✗ %s (Vault failed)\n", name)
	}

	// 4. Inject Neon config values
	if cfg.Deploy.Neon.AuthURL != "" {
		secrets["NEON_AUTH_BASE_URL"] = cfg.Deploy.Neon.AuthURL
	}
	if cfg.Deploy.Neon.JWKSURL != "" {
		secrets["NEON_AUTH_JWKS_URL"] = cfg.Deploy.Neon.JWKSURL
	}
	for key, value := range childAppRuntimeEnv(cfg) {
		if _, exists := secrets[key]; !exists && strings.TrimSpace(value) != "" {
			secrets[key] = value
		}
	}

	flyBin, err := findFlyBinary()
	if err != nil {
		return err
	}

	// 5. Ensure the Fly app exists before setting secrets or deploying.
	if !deployDryRun {
		if err := ensureFlyAppExists(flyBin, appName, fly.Org); err != nil {
			return err
		}
	} else {
		if strings.TrimSpace(fly.Org) != "" {
			fmt.Printf("[bui] DRY RUN: would ensure Fly app %s exists in org %s\n", appName, fly.Org)
		} else {
			fmt.Printf("[bui] DRY RUN: would ensure Fly app %s exists\n", appName)
		}
	}

	// 6. Set secrets via fly CLI
	if !deployDryRun {
		fmt.Printf("[bui] setting secrets for %s...\n", appName)
		flySecretArgs := []string{"secrets", "set", "--app", appName}
		for k, v := range secrets {
			flySecretArgs = append(flySecretArgs, k+"="+v)
		}
		flyCmd := exec.Command(flyBin, flySecretArgs...)
		flyCmd.Stdout = os.Stdout
		flyCmd.Stderr = os.Stderr
		if err := flyCmd.Run(); err != nil {
			return fmt.Errorf("fly secrets set: %w", err)
		}
	} else {
		fmt.Printf("[bui] DRY RUN: would set %d secrets for %s\n", len(secrets), appName)
	}

	// 7. Find fly.toml — prefer deploy/fly/fly.toml, then deploy/fly/fly.control-plane.toml
	flyToml := findFlyToml(root)
	if flyToml == "" {
		return fmt.Errorf("no fly.toml found in deploy/fly/")
	}
	fmt.Printf("[bui] using %s\n", flyToml)

	// 8. Deploy
	if !deployDryRun {
		fmt.Printf("[bui] deploying %s...\n", appName)
		output, err := runFlyDeploy(flyBin, root, flyToml)
		if err != nil {
			if shouldRetryFlyDeployWithoutDepot(output) {
				fmt.Println("[bui] fly deploy via Depot failed; retrying with --depot=false")
				if _, retryErr := runFlyDeploy(flyBin, root, flyToml, "--depot=false"); retryErr != nil {
					return fmt.Errorf("fly deploy: %w (retry without depot: %v)", err, retryErr)
				}
			} else {
				return fmt.Errorf("fly deploy: %w", err)
			}
		}
		fmt.Println("[bui] deploy complete")
	} else {
		fmt.Printf("[bui] DRY RUN: would run fly deploy -c %s\n", flyToml)
	}

	return nil
}

func runFlyDeploy(flyBin, root, flyToml string, extraArgs ...string) (string, error) {
	args := []string{"deploy", "-c", flyToml}
	args = append(args, extraArgs...)
	deployCmd := exec.Command(flyBin, args...)
	deployCmd.Dir = root
	var output bytes.Buffer
	writer := io.MultiWriter(os.Stdout, &output)
	deployCmd.Stdout = writer
	deployCmd.Stderr = writer
	err := deployCmd.Run()
	return output.String(), err
}

func shouldRetryFlyDeployWithoutDepot(output string) bool {
	lower := strings.ToLower(output)
	if !strings.Contains(lower, "depot") {
		return false
	}
	return strings.Contains(lower, "authentication handshake failed") ||
		strings.Contains(lower, "invalid token") ||
		strings.Contains(lower, "failed to get status") ||
		strings.Contains(lower, "failed to fetch an image or build from source")
}

func ensureFlyAppExists(flyBin, appName, org string) error {
	statusCmd := exec.Command(flyBin, "status", "--app", appName)
	statusCmd.Stdout = os.Stdout
	statusCmd.Stderr = os.Stderr
	if err := statusCmd.Run(); err == nil {
		fmt.Printf("[bui] Fly app %s already exists\n", appName)
		return nil
	}

	createArgs := []string{"apps", "create", appName}
	if strings.TrimSpace(org) != "" {
		createArgs = append(createArgs, "--org", org)
	}
	fmt.Printf("[bui] Fly app %s not found; creating it...\n", appName)

	createCmd := exec.Command(flyBin, createArgs...)
	createCmd.Stdout = os.Stdout
	createCmd.Stderr = os.Stderr
	if err := createCmd.Run(); err != nil {
		return fmt.Errorf("fly apps create: %w", err)
	}

	fmt.Printf("[bui] Fly app %s created\n", appName)
	return nil
}

func findFlyToml(root string) string {
	candidates := []string{
		filepath.Join(root, "deploy", "fly", "fly.toml"),
		filepath.Join(root, "deploy", "fly", "fly.control-plane.toml"),
		filepath.Join(root, "fly.toml"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

func deployDocker(cfg *config.AppConfig, root string) error {
	return fmt.Errorf("docker deploy not yet implemented (use deploy/fly/ for Fly.io)")
}

func deployModal(cfg *config.AppConfig, root string) error {
	checkFrameworkDrift(cfg)
	if !deploySkipBuild {
		fmt.Println("[bui] building frontend...")
		if err := buildFrontend(cfg, root); err != nil {
			return fmt.Errorf("build: %w", err)
		}
	}

	fmt.Println("[bui] resolving secrets from Vault...")
	secrets, failed := vaultpkg.ResolveSecrets(cfg.Deploy.Secrets)
	for k := range secrets {
		fmt.Printf("  ✓ %s\n", k)
	}
	for _, k := range failed {
		fmt.Printf("  ✗ %s (Vault failed)\n", k)
	}
	if cfg.Deploy.Neon.AuthURL != "" {
		secrets["NEON_AUTH_BASE_URL"] = cfg.Deploy.Neon.AuthURL
	}
	if cfg.Deploy.Neon.JWKSURL != "" {
		secrets["NEON_AUTH_JWKS_URL"] = cfg.Deploy.Neon.JWKSURL
	}
	for k, v := range cfg.Deploy.DeployEnv {
		secrets[k] = v
	}

	fwPath, _ := framework.Resolve(cfg, "deploy")
	if fwPath == "" {
		fwPath, _ = framework.Resolve(cfg, "dev")
	}
	modalFile := findModalFile(root)
	if fwPath != "" {
		fwModal := filepath.Join(fwPath, "deploy", "core", "modal_app.py")
		if _, err := os.Stat(fwModal); err == nil {
			modalFile = fwModal
		}
	}
	if modalFile == "" {
		return fmt.Errorf("no modal_app.py found in framework or deploy/")
	}

	modalAppName := cfg.Deploy.Modal.AppName
	if modalAppName == "" {
		modalAppName = cfg.App.Name
	}
	if cfg.Deploy.Env != "" && cfg.Deploy.Env != "prod" {
		modalAppName = modalAppName + "-" + cfg.Deploy.Env
	}

	fmt.Printf("[bui] deploying %s via modal...\n", modalAppName)
	modal := exec.Command("modal", "deploy", modalFile)
	modal.Dir = root
	modal.Stdout = os.Stdout
	modal.Stderr = os.Stderr
	modal.Env = os.Environ()
	for k, v := range secrets {
		if strings.Contains(v, "\x00") {
			return fmt.Errorf("secret %s contains null byte", k)
		}
		modal.Env = append(modal.Env, k+"="+v)
	}
	modal.Env = append(modal.Env,
		"BUI_APP_TOML="+filepath.Join(root, config.ConfigFile),
		"BUI_MODAL_APP_NAME="+modalAppName,
		"BUI_DEPLOY_ENV="+cfg.Deploy.Env,
	)
	if fwPath != "" {
		modal.Env = append(modal.Env, "BUI_FRAMEWORK_PATH="+fwPath)
	}
	return modal.Run()
}

// ensureSessionSecret reads or creates a stable session secret in .boring/session-secret.
func ensureSessionSecret(root string) (string, error) {
	boringDir := filepath.Join(root, ".boring")
	secretFile := filepath.Join(boringDir, "session-secret")

	data, err := os.ReadFile(secretFile)
	if err == nil {
		s := strings.TrimSpace(string(data))
		if len(s) >= 32 {
			return s, nil
		}
	}

	// Generate new secret
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	secret := hex.EncodeToString(buf)

	os.MkdirAll(boringDir, 0o700)
	if err := os.WriteFile(secretFile, []byte(secret+"\n"), 0o600); err != nil {
		return "", err
	}
	fmt.Printf("[bui] generated new session secret → %s\n", secretFile)
	return secret, nil
}

// ensureSettingsKey reads or creates a stable settings encryption key in .boring/settings-key.
func ensureSettingsKey(root string) (string, error) {
	boringDir := filepath.Join(root, ".boring")
	keyFile := filepath.Join(boringDir, "settings-key")

	data, err := os.ReadFile(keyFile)
	if err == nil {
		s := strings.TrimSpace(string(data))
		if len(s) >= 32 {
			return s, nil
		}
	}

	// Generate new key
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	key := hex.EncodeToString(buf)

	os.MkdirAll(boringDir, 0o700)
	if err := os.WriteFile(keyFile, []byte(key+"\n"), 0o600); err != nil {
		return "", err
	}
	fmt.Printf("[bui] generated new settings key → %s\n", keyFile)
	return key, nil
}

func init() {
	deployCmd.Flags().BoolVar(&deploySkipBuild, "skip-build", false, "Skip frontend build")
	deployCmd.Flags().StringVar(&deployEnv, "env", "", "Override deploy environment (default from config)")
	deployCmd.Flags().BoolVar(&deployDryRun, "dry-run", false, "Show what would be done without executing")
}

func checkFrameworkDrift(cfg *config.AppConfig) {
	fwPath, _ := framework.Resolve(cfg, "dev")
	if fwPath == "" || cfg.Framework.Commit == "" {
		return
	}
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = fwPath
	out, err := cmd.Output()
	if err != nil {
		return
	}
	head := strings.TrimSpace(string(out))
	pin := cfg.Framework.Commit
	if !strings.HasPrefix(head, pin) && !strings.HasPrefix(pin, head) {
		short := pin
		if len(short) > 7 {
			short = short[:7]
		}
		fmt.Printf("[bui] WARN: ../boring-ui HEAD=%s, config pins %s. Run `bui upgrade`?\n", head[:7], short)
	}
}

func buildFrontend(cfg *config.AppConfig, root string) error {
	fwPath, err := framework.Resolve(cfg, "dev")
	if err != nil {
		return err
	}

	// Build dir: frontend root if set, otherwise framework path
	buildDir := fwPath
	if cfg.Frontend.Root != "" {
		buildDir = filepath.Join(root, cfg.Frontend.Root)
		// Ensure boring-ui symlink exists for the build
		if err := framework.LinkFrontend(fwPath, buildDir); err != nil {
			fmt.Printf("[bui] warn: frontend symlink: %v\n", err)
		}
	}

	outDir := filepath.Join(root, "dist", "web")
	vite := exec.Command("npx", "vite", "build", "--outDir", outDir)
	vite.Dir = buildDir
	vite.Stdout = os.Stdout
	vite.Stderr = os.Stderr
	vite.Env = append(os.Environ(),
		fmt.Sprintf("BUI_APP_TOML=%s", filepath.Join(root, config.ConfigFile)),
	)
	return vite.Run()
}

// loadNeonEnvField reads a field from .boring/neon-config.env (fallback when Vault is unavailable).
func loadNeonEnvField(root, key string) string {
	data, err := os.ReadFile(filepath.Join(root, ".boring", "neon-config.env"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, key+"=") {
			return strings.TrimPrefix(line, key+"=")
		}
	}
	return ""
}

func findModalFile(root string) string {
	// Check common locations
	candidates := []string{
		filepath.Join(root, "deploy", "modal_app.py"),
		filepath.Join(root, "deploy", "core", "modal_app.py"),
		filepath.Join(root, "deploy", "edge", "modal_app.py"),
		filepath.Join(root, "modal_app.py"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

func applyNeonFallbackSecrets(root string, refs map[string]config.SecretRef, resolved map[string]string, failed []string) (map[string]string, []string, error) {
	fallbackSources := make(map[string]string, len(failed))
	unresolved := make([]string, 0, len(failed))

	for _, name := range failed {
		ref, ok := refs[name]
		if !ok {
			unresolved = append(unresolved, name)
			continue
		}

		value, source, ok, err := fallbackSecretValue(root, ref.Field)
		if err != nil {
			return nil, nil, err
		}
		if !ok {
			unresolved = append(unresolved, name)
			continue
		}

		resolved[name] = value
		fallbackSources[name] = source
	}

	sort.Strings(unresolved)
	return fallbackSources, unresolved, nil
}

func fallbackSecretValue(root, field string) (string, string, bool, error) {
	switch strings.TrimSpace(field) {
	case "database_url":
		return loadFallbackEnv(root, "DATABASE_POOLER_URL", "DATABASE_URL")
	case "database_direct_url":
		return loadFallbackEnv(root, "DATABASE_URL")
	case "session_secret":
		return loadFallbackEnv(root, "BORING_UI_SESSION_SECRET")
	case "settings_key":
		if value, source, ok, err := loadFallbackEnv(root, "BORING_SETTINGS_KEY"); ok || err != nil {
			return value, source, ok, err
		}
		value, err := ensureSettingsKey(root)
		if err != nil {
			return "", "", false, fmt.Errorf("ensure settings key fallback: %w", err)
		}
		return value, ".boring/settings-key", true, nil
	case "neon_project_id":
		return loadFallbackEnv(root, "NEON_PROJECT_ID")
	case "neon_branch_id":
		return loadFallbackEnv(root, "NEON_BRANCH_ID")
	default:
		return "", "", false, nil
	}
}

func loadFallbackEnv(root string, keys ...string) (string, string, bool, error) {
	for _, key := range keys {
		if value := loadNeonEnvField(root, key); value != "" {
			return value, ".boring/neon-config.env:" + key, true, nil
		}
	}
	return "", "", false, nil
}

func buildDockerImageRef(registry, appName, env string) string {
	base := strings.TrimRight(strings.TrimSpace(registry), "/")
	tag := strings.TrimSpace(env)
	if tag == "" || tag == "prod" {
		tag = "latest"
	}
	return fmt.Sprintf("%s/%s:%s", base, appName, tag)
}

func renderEnvFile(env map[string]string) string {
	keys := sortedKeys(env)
	var builder strings.Builder
	for _, key := range keys {
		builder.WriteString(key)
		builder.WriteByte('=')
		builder.WriteString(strings.ReplaceAll(env[key], "\n", `\n`))
		builder.WriteByte('\n')
	}
	return builder.String()
}

func shellEnvPrefix(env map[string]string) string {
	keys := sortedKeys(env)
	var builder strings.Builder
	for _, key := range keys {
		value := env[key]
		if value == "" {
			continue
		}
		builder.WriteString(key)
		builder.WriteByte('=')
		builder.WriteString(shellQuote(value))
		builder.WriteByte(' ')
	}
	return builder.String()
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}

func sortedKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
