package auth

import (
	"context"
	"os"
	"strings"
)

const (
	defaultDevUserID    = "dev-user"
	defaultDevUserEmail = "dev@localhost"
)

// LocalProvider is the development auth backend used before Neon auth lands.
type LocalProvider struct {
	autoLogin bool
	devUser   User
}

func NewLocalProvider(autoLogin bool, devUser User) *LocalProvider {
	if strings.TrimSpace(devUser.ID) == "" {
		devUser.ID = defaultDevUserID
	}
	if strings.TrimSpace(devUser.Email) == "" {
		devUser.Email = defaultDevUserEmail
	}
	devUser.Email = normalizeEmail(devUser.Email)
	if !devUser.IsOwner {
		devUser.IsOwner = true
	}

	return &LocalProvider{
		autoLogin: autoLogin,
		devUser:   devUser,
	}
}

func NewLocalProviderFromEnv() *LocalProvider {
	return NewLocalProvider(isEnvEnabled(os.Getenv("DEV_AUTOLOGIN")), User{
		ID:      os.Getenv("AUTH_DEV_USER_ID"),
		Email:   os.Getenv("AUTH_DEV_EMAIL"),
		IsOwner: true,
	})
}

func (p *LocalProvider) AutoLoginEnabled() bool {
	return p != nil && p.autoLogin
}

func (p *LocalProvider) Login(_ context.Context, _, _ string) (*User, error) {
	if !p.autoLogin {
		return nil, ErrInvalidCredentials
	}

	user := p.devUser
	return &user, nil
}

func isEnvEnabled(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
