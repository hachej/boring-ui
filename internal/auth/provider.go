package auth

import (
	"context"
	"errors"
	"strings"
)

var ErrInvalidCredentials = errors.New("invalid credentials")

// User is the canonical authenticated identity shared by providers and middleware.
type User struct {
	ID      string `json:"id"`
	Email   string `json:"email"`
	IsOwner bool   `json:"is_owner"`
}

// Provider authenticates a user and returns the normalized identity on success.
type Provider interface {
	Login(ctx context.Context, email, password string) (*User, error)
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
