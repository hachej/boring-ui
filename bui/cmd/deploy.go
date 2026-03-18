package cmd

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
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
)

var deployCmd = &cobra.Command{
	Use:   "deploy",
	Short: "Build frontend, resolve secrets, deploy to the configured platform",
	Long: `Build frontend, resolve Vault secrets, deploy to the configured platform.
Use --env to target staging/dev (separate Vault path + deploy target names).

Run 'bui docs deploy' for the full deploy workflow.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, root := config.MustLoad()
		if deployEnv != "" {
			cfg.Deploy.Env = deployEnv
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

		secrets, failed, err := resolveDeploySecrets(cfg, root)
		if err != nil {
			return err
		}
		if len(failed) > 0 {
			fmt.Printf("[bui] warn: %d secret(s) unresolved: %s\n", len(failed), strings.Join(failed, ", "))
		}

		switch strings.ToLower(strings.TrimSpace(cfg.Deploy.Platform)) {
		case "", "modal":
			return runModalDeploy(cfg, root, secrets)
		case "docker":
			return runDockerDeploy(cfg, root, secrets)
		default:
			return fmt.Errorf("unsupported deploy platform %q", cfg.Deploy.Platform)
		}
	},
}

type dockerDeployTarget struct {
	ImageRef          string
	PublicHost        string
	SSHHost           string
	SSHUser           string
	ComposeFile       string
	RemoteDir         string
	Dockerfile        string
	CaddyFile         string
	SSHKeyPath        string
	SSHKeyCleanup     func()
	ControlPlaneAppID string
}

func resolveDeploySecrets(cfg *config.AppConfig, root string) (map[string]string, []string, error) {
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
		fmt.Println("  ✓ NEON_AUTH_BASE_URL (from config)")
	}
	if cfg.Deploy.Neon.JWKSURL != "" {
		secrets["NEON_AUTH_JWKS_URL"] = cfg.Deploy.Neon.JWKSURL
		fmt.Println("  ✓ NEON_AUTH_JWKS_URL (from config)")
	}

	if _, ok := secrets["DATABASE_URL"]; !ok {
		if dbURL := loadNeonEnvField(root, "DATABASE_POOLER_URL"); dbURL != "" {
			secrets["DATABASE_URL"] = dbURL
			fmt.Println("  ✓ DATABASE_URL (from .boring/neon-config.env)")
		}
	}
	if _, ok := secrets["BORING_UI_SESSION_SECRET"]; !ok {
		if ss := loadNeonEnvField(root, "BORING_UI_SESSION_SECRET"); ss != "" {
			secrets["BORING_UI_SESSION_SECRET"] = ss
			fmt.Println("  ✓ BORING_UI_SESSION_SECRET (from .boring/neon-config.env)")
		} else {
			secret, err := ensureSessionSecret(root)
			if err != nil {
				return nil, nil, fmt.Errorf("session secret: %w", err)
			}
			secrets["BORING_UI_SESSION_SECRET"] = secret
			fmt.Println("  ✓ BORING_UI_SESSION_SECRET (generated)")
		}
	}
	if _, ok := secrets["BORING_SETTINGS_KEY"]; !ok {
		if sk := loadNeonEnvField(root, "BORING_SETTINGS_KEY"); sk != "" {
			secrets["BORING_SETTINGS_KEY"] = sk
			fmt.Println("  ✓ BORING_SETTINGS_KEY (from .boring/neon-config.env)")
		} else {
			sk, err := ensureSettingsKey(root)
			if err != nil {
				return nil, nil, fmt.Errorf("settings key: %w", err)
			}
			secrets["BORING_SETTINGS_KEY"] = sk
			fmt.Println("  ✓ BORING_SETTINGS_KEY (generated)")
		}
	}
	for k, v := range cfg.Deploy.DeployEnv {
		secrets[k] = v
		fmt.Printf("  ✓ %s (from config)\n", k)
	}
	return secrets, failed, nil
}

func runModalDeploy(cfg *config.AppConfig, root string, secrets map[string]string) error {
	fwPath, _ := framework.Resolve(cfg, "deploy")
	if fwPath == "" {
		fwPath, _ = framework.Resolve(cfg, "dev")
	}

	modalFile := findModalFile(root)
	if fwPath != "" {
		fwModal := filepath.Join(fwPath, "deploy", "core", "modal_app.py")
		if _, err := os.Stat(fwModal); err == nil {
			if modalFile != "" && modalFile != fwModal {
				fmt.Printf("[bui] note: ignoring local %s, using framework template\n", modalFile)
			}
			modalFile = fwModal
		}
	}
	if modalFile == "" {
		return fmt.Errorf("no modal_app.py found in framework or deploy/")
	}
	fmt.Printf("[bui] using %s\n", modalFile)

	modalAppName := cfg.Deploy.Modal.AppName
	if modalAppName == "" {
		modalAppName = cfg.App.Name
	}
	if cfg.Deploy.Env != "" && cfg.Deploy.Env != "prod" {
		modalAppName = modalAppName + "-" + cfg.Deploy.Env
	}

	fmt.Printf("[bui] deploying %s (env=%s)...\n", modalAppName, cfg.Deploy.Env)
	modal := exec.Command("modal", "deploy", modalFile)
	modal.Dir = root
	modal.Stdout = os.Stdout
	modal.Stderr = os.Stderr
	modal.Env = os.Environ()
	for k, v := range secrets {
		if strings.Contains(v, "\x00") {
			return fmt.Errorf("secret %s contains null byte — cannot inject as env var", k)
		}
		modal.Env = append(modal.Env, k+"="+v)
	}
	modal.Env = append(modal.Env,
		fmt.Sprintf("BUI_APP_TOML=%s", filepath.Join(root, config.ConfigFile)),
		fmt.Sprintf("BUI_MODAL_APP_NAME=%s", modalAppName),
		fmt.Sprintf("BUI_DEPLOY_ENV=%s", cfg.Deploy.Env),
	)
	if fwPath != "" {
		modal.Env = append(modal.Env, fmt.Sprintf("BUI_FRAMEWORK_PATH=%s", fwPath))
		fmt.Printf("[bui] framework: %s\n", fwPath)
	}

	if err := modal.Run(); err != nil {
		return fmt.Errorf("modal deploy: %w", err)
	}

	fmt.Println("[bui] deploy complete")
	return nil
}

func runDockerDeploy(cfg *config.AppConfig, root string, secrets map[string]string) error {
	target, err := resolveDockerDeployTarget(cfg)
	if err != nil {
		return err
	}
	if target.SSHKeyCleanup != nil {
		defer target.SSHKeyCleanup()
	}
	if cfg.Deploy.DeployEnv == nil {
		cfg.Deploy.DeployEnv = map[string]string{}
	}

	if _, ok := secrets["DATABASE_URL"]; ok {
		if _, exists := cfg.Deploy.DeployEnv["CONTROL_PLANE_ENABLED"]; !exists {
			cfg.Deploy.DeployEnv["CONTROL_PLANE_ENABLED"] = "true"
		}
	}
	if _, exists := cfg.Deploy.DeployEnv["CONTROL_PLANE_PROVIDER"]; !exists {
		cfg.Deploy.DeployEnv["CONTROL_PLANE_PROVIDER"] = "neon"
	}
	if _, exists := cfg.Deploy.DeployEnv["CONTROL_PLANE_APP_ID"]; !exists {
		cfg.Deploy.DeployEnv["CONTROL_PLANE_APP_ID"] = target.ControlPlaneAppID
	}

	fmt.Printf("[bui] building and pushing %s...\n", target.ImageRef)
	if err := dockerBuildAndPush(root, target.ImageRef, target.Dockerfile); err != nil {
		return err
	}

	tempDir, err := os.MkdirTemp("", "bui-docker-deploy-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tempDir)

	envFile := filepath.Join(tempDir, "backend.env")
	if err := os.WriteFile(envFile, []byte(renderEnvFile(secrets)), 0o600); err != nil {
		return fmt.Errorf("write backend env: %w", err)
	}

	composeSource := resolveLocalPath(root, target.ComposeFile)
	caddySource := resolveLocalPath(root, target.CaddyFile)
	if _, err := os.Stat(composeSource); err != nil {
		return fmt.Errorf("compose file %s: %w", composeSource, err)
	}
	if _, err := os.Stat(caddySource); err != nil {
		return fmt.Errorf("caddy file %s: %w", caddySource, err)
	}

	remoteCompose := filepath.Join(target.RemoteDir, filepath.ToSlash(target.ComposeFile))
	remoteCaddy := filepath.Join(target.RemoteDir, filepath.ToSlash(target.CaddyFile))
	remoteEnvFile := filepath.Join(target.RemoteDir, "shared", "backend.env")

	setupScript := fmt.Sprintf(
		"set -eu\nmkdir -p %s %s %s /data/workspaces\nchown 10001:10001 /data/workspaces\n",
		shellQuote(filepath.Dir(remoteCompose)),
		shellQuote(filepath.Dir(remoteCaddy)),
		shellQuote(filepath.Dir(remoteEnvFile)),
	)
	if err := runRemoteScript(target, setupScript); err != nil {
		return err
	}
	if err := scpToRemote(target, composeSource, remoteCompose); err != nil {
		return err
	}
	if err := scpToRemote(target, caddySource, remoteCaddy); err != nil {
		return err
	}
	if err := scpToRemote(target, envFile, remoteEnvFile); err != nil {
		return err
	}

	composeEnv := map[string]string{
		"BORING_UI_IMAGE":                target.ImageRef,
		"BUI_BACKEND_ENV_FILE":           remoteEnvFile,
		"BUI_CADDYFILE":                  "./python/Caddyfile.prod",
		"BUI_HOSTNAME":                   target.PublicHost,
		"CONTROL_PLANE_ENABLED":          cfg.Deploy.DeployEnv["CONTROL_PLANE_ENABLED"],
		"CONTROL_PLANE_PROVIDER":         cfg.Deploy.DeployEnv["CONTROL_PLANE_PROVIDER"],
		"CONTROL_PLANE_APP_ID":           cfg.Deploy.DeployEnv["CONTROL_PLANE_APP_ID"],
		"BORING_UI_WORKSPACES_HOST_PATH": "/data/workspaces",
	}
	envPrefix := shellEnvPrefix(composeEnv)

	var script strings.Builder
	script.WriteString("set -eu\n")
	if username := strings.TrimSpace(os.Getenv("GHCR_USERNAME")); username != "" {
		if token := os.Getenv("GHCR_TOKEN"); token != "" {
			fmt.Fprintf(&script,
				"printf '%%s' %s | docker login ghcr.io -u %s --password-stdin >/dev/null\n",
				shellQuote(token),
				shellQuote(username),
			)
		}
	}
	fmt.Fprintf(&script, "cd %s\n", shellQuote(target.RemoteDir))
	fmt.Fprintf(&script, "%sdocker compose -f %s pull\n", envPrefix, shellQuote(remoteCompose))
	fmt.Fprintf(&script, "%sdocker compose -f %s up -d --remove-orphans\n", envPrefix, shellQuote(remoteCompose))
	fmt.Fprintf(&script, "%sdocker compose -f %s ps\n", envPrefix, shellQuote(remoteCompose))
	if err := runRemoteScript(target, script.String()); err != nil {
		return err
	}

	fmt.Printf("[bui] deploy complete: https://%s\n", target.PublicHost)
	return nil
}

func resolveDockerDeployTarget(cfg *config.AppConfig) (*dockerDeployTarget, error) {
	dockerCfg := cfg.Deploy.Docker
	publicHost := strings.TrimSpace(dockerCfg.Host)
	if publicHost == "" {
		return nil, fmt.Errorf("deploy.docker.host is required for docker deploys")
	}

	sshHost := strings.TrimSpace(dockerCfg.SSHHost)
	if sshHost == "" {
		sshHost, _ = vaultpkg.Get(cfg.AppVaultPath(), "deploy_host")
	}
	if sshHost == "" {
		sshHost = publicHost
	}

	sshUser := strings.TrimSpace(dockerCfg.SSHUser)
	if sshUser == "" {
		sshUser, _ = vaultpkg.Get(cfg.AppVaultPath(), "deploy_user")
	}
	if sshUser == "" {
		sshUser = "root"
	}

	composeFile := strings.TrimSpace(dockerCfg.ComposeFile)
	if composeFile == "" {
		composeFile = "deploy/docker-compose.prod.yml"
	}
	dockerfile := strings.TrimSpace(dockerCfg.Dockerfile)
	if dockerfile == "" {
		dockerfile = "deploy/python/Dockerfile"
	}
	caddyFile := strings.TrimSpace(dockerCfg.CaddyFile)
	if caddyFile == "" {
		caddyFile = "deploy/python/Caddyfile.prod"
	}
	remoteDir := strings.TrimSpace(dockerCfg.RemoteDir)
	if remoteDir == "" {
		remoteDir = filepath.Join("/opt", cfg.App.ID)
	}

	imageRef := strings.TrimSpace(dockerCfg.Image)
	if imageRef == "" {
		imageRef = buildDockerImageRef(dockerCfg.Registry, cfg.App.ID, cfg.Deploy.Env)
	}
	if imageRef == "" {
		return nil, fmt.Errorf("deploy.docker.registry or deploy.docker.image is required for docker deploys")
	}

	sshKeyPath, cleanup, err := resolveDeploySSHKey(strings.TrimSpace(dockerCfg.SSHKeyVault))
	if err != nil {
		return nil, err
	}

	return &dockerDeployTarget{
		ImageRef:          imageRef,
		PublicHost:        publicHost,
		SSHHost:           sshHost,
		SSHUser:           sshUser,
		ComposeFile:       filepath.ToSlash(composeFile),
		RemoteDir:         filepath.Clean(remoteDir),
		Dockerfile:        filepath.ToSlash(dockerfile),
		CaddyFile:         filepath.ToSlash(caddyFile),
		SSHKeyPath:        sshKeyPath,
		SSHKeyCleanup:     cleanup,
		ControlPlaneAppID: cfg.App.ID,
	}, nil
}

func buildDockerImageRef(registry, appID, env string) string {
	registry = strings.TrimRight(strings.TrimSpace(registry), "/")
	appID = strings.TrimSpace(appID)
	if registry == "" || appID == "" {
		return ""
	}

	tag := "latest"
	if trimmedEnv := strings.TrimSpace(env); trimmedEnv != "" && trimmedEnv != "prod" {
		tag = trimmedEnv
	}
	return fmt.Sprintf("%s/%s:%s", registry, appID, tag)
}

func dockerBuildAndPush(root, imageRef, dockerfile string) error {
	buildx := exec.Command(
		"docker", "buildx", "build",
		"--platform", "linux/amd64",
		"-f", dockerfile,
		"-t", imageRef,
		"--push",
		".",
	)
	buildx.Dir = root
	buildx.Stdout = os.Stdout
	buildx.Stderr = os.Stderr
	if err := buildx.Run(); err == nil {
		return nil
	}

	fmt.Println("[bui] docker buildx unavailable; falling back to docker build + docker push")
	build := exec.Command("docker", "build", "-f", dockerfile, "-t", imageRef, ".")
	build.Dir = root
	build.Stdout = os.Stdout
	build.Stderr = os.Stderr
	if err := build.Run(); err != nil {
		return fmt.Errorf("docker build: %w", err)
	}

	push := exec.Command("docker", "push", imageRef)
	push.Dir = root
	push.Stdout = os.Stdout
	push.Stderr = os.Stderr
	if err := push.Run(); err != nil {
		return fmt.Errorf("docker push: %w", err)
	}
	return nil
}

func renderEnvFile(values map[string]string) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	var b strings.Builder
	for _, key := range keys {
		if strings.Contains(values[key], "\x00") {
			continue
		}
		b.WriteString(key)
		b.WriteByte('=')
		b.WriteString(escapeEnvValue(values[key]))
		b.WriteByte('\n')
	}
	return b.String()
}

func escapeEnvValue(value string) string {
	replacer := strings.NewReplacer("\\", "\\\\", "\n", "\\n", "\r", "\\r")
	return replacer.Replace(value)
}

func shellEnvPrefix(values map[string]string) string {
	keys := make([]string, 0, len(values))
	for key, value := range values {
		if strings.TrimSpace(value) == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)

	var b strings.Builder
	for _, key := range keys {
		b.WriteString(key)
		b.WriteByte('=')
		b.WriteString(shellQuote(values[key]))
		b.WriteByte(' ')
	}
	return b.String()
}

func resolveDeploySSHKey(vaultPath string) (string, func(), error) {
	if keyPath := strings.TrimSpace(os.Getenv("BUI_DEPLOY_SSH_KEY_PATH")); keyPath != "" {
		if _, err := os.Stat(keyPath); err != nil {
			return "", nil, fmt.Errorf("BUI_DEPLOY_SSH_KEY_PATH %s: %w", keyPath, err)
		}
		return keyPath, nil, nil
	}

	if privateKey := strings.TrimSpace(os.Getenv("BUI_DEPLOY_SSH_KEY")); privateKey != "" {
		tempDir, err := os.MkdirTemp("", "bui-ssh-key-*")
		if err != nil {
			return "", nil, err
		}
		keyPath := filepath.Join(tempDir, "id_ed25519")
		if err := os.WriteFile(keyPath, []byte(privateKey+"\n"), 0o600); err != nil {
			_ = os.RemoveAll(tempDir)
			return "", nil, err
		}
		return keyPath, func() { _ = os.RemoveAll(tempDir) }, nil
	}

	if vaultPath != "" {
		privateKey, err := vaultpkg.Get(vaultPath, "private_key")
		if err == nil {
			tempDir, err := os.MkdirTemp("", "bui-ssh-key-*")
			if err != nil {
				return "", nil, err
			}
			keyPath := filepath.Join(tempDir, "id_ed25519")
			if err := os.WriteFile(keyPath, []byte(privateKey+"\n"), 0o600); err != nil {
				_ = os.RemoveAll(tempDir)
				return "", nil, err
			}
			return keyPath, func() { _ = os.RemoveAll(tempDir) }, nil
		}
		fmt.Printf("[bui] warn: could not read %s from Vault, trying local SSH key fallback\n", vaultPath)
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", nil, err
	}
	keyPath := filepath.Join(home, ".ssh", "id_ed25519")
	if _, err := os.Stat(keyPath); err != nil {
		return "", nil, fmt.Errorf("no deploy ssh key configured; set deploy.docker.ssh_key_vault or ensure %s exists", keyPath)
	}
	return keyPath, nil, nil
}

func runRemoteScript(target *dockerDeployTarget, script string) error {
	remote := fmt.Sprintf("%s@%s", target.SSHUser, target.SSHHost)
	cmd := exec.Command(
		"ssh",
		"-i", target.SSHKeyPath,
		"-o", "BatchMode=yes",
		"-o", "StrictHostKeyChecking=accept-new",
		remote,
		"sh",
	)
	cmd.Stdin = strings.NewReader(script)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ssh %s: %w", remote, err)
	}
	return nil
}

func scpToRemote(target *dockerDeployTarget, localPath, remotePath string) error {
	remote := fmt.Sprintf("%s@%s:%s", target.SSHUser, target.SSHHost, remotePath)
	cmd := exec.Command(
		"scp",
		"-i", target.SSHKeyPath,
		"-o", "BatchMode=yes",
		"-o", "StrictHostKeyChecking=accept-new",
		localPath,
		remote,
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("scp %s -> %s: %w", localPath, remote, err)
	}
	return nil
}

func resolveLocalPath(root, rel string) string {
	if filepath.IsAbs(rel) {
		return rel
	}
	return filepath.Join(root, filepath.FromSlash(rel))
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
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
