package auth

import (
	"context"
	"errors"
	"testing"
)

func TestLocalProviderAutoLoginFromEnv(t *testing.T) {
	t.Setenv("DEV_AUTOLOGIN", "1")
	t.Setenv("AUTH_DEV_USER_ID", "dev-123")
	t.Setenv("AUTH_DEV_EMAIL", "Dev@Example.com")

	provider := NewLocalProviderFromEnv()
	user, err := provider.Login(context.Background(), "ignored@example.com", "ignored")
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	if user.ID != "dev-123" {
		t.Fatalf("expected env user id, got %q", user.ID)
	}
	if user.Email != "dev@example.com" {
		t.Fatalf("expected normalized email, got %q", user.Email)
	}
	if !user.IsOwner {
		t.Fatal("expected dev user to be owner")
	}
}

func TestLocalProviderRejectsWhenAutoLoginDisabled(t *testing.T) {
	provider := NewLocalProvider(false, User{})

	_, err := provider.Login(context.Background(), "user@example.com", "secret")
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}
