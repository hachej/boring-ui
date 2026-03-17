package auth

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestSessionManagerRoundTrip(t *testing.T) {
	fixedNow := time.Date(2026, 3, 13, 12, 0, 0, 0, time.UTC)
	manager := NewSessionManager(SessionConfig{
		Secret: "test-secret",
		TTL:    DefaultSessionTTL,
		Now:    func() time.Time { return fixedNow },
	})

	token, err := manager.Create(User{
		ID:      "user-123",
		Email:   "User@Example.com",
		IsOwner: true,
	})
	if err != nil {
		t.Fatalf("create token: %v", err)
	}

	authCtx, err := manager.Parse(token)
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}

	if authCtx.UserID != "user-123" {
		t.Fatalf("expected subject to round-trip, got %q", authCtx.UserID)
	}
	if authCtx.Email != "user@example.com" {
		t.Fatalf("expected normalized email, got %q", authCtx.Email)
	}
	if !authCtx.IsOwner {
		t.Fatal("expected owner bit to round-trip")
	}
}

func TestSessionManagerRejectsExpiredTokens(t *testing.T) {
	issuedAt := time.Date(2026, 3, 13, 12, 0, 0, 0, time.UTC)
	issuer := NewSessionManager(SessionConfig{
		Secret: "test-secret",
		TTL:    time.Hour,
		Now:    func() time.Time { return issuedAt },
	})

	token, err := issuer.Create(User{
		ID:    "user-123",
		Email: "user@example.com",
	})
	if err != nil {
		t.Fatalf("create token: %v", err)
	}

	validator := NewSessionManager(SessionConfig{
		Secret: "test-secret",
		TTL:    time.Hour,
		Now:    func() time.Time { return issuedAt.Add(2*time.Hour + clockSkewLeeway) },
	})

	_, err = validator.Parse(token)
	if !errors.Is(err, ErrSessionExpired) {
		t.Fatalf("expected ErrSessionExpired, got %v", err)
	}
}

func TestSessionManagerRejectsTamperedTokens(t *testing.T) {
	manager := NewSessionManager(SessionConfig{
		Secret: "test-secret",
		TTL:    DefaultSessionTTL,
		Now:    func() time.Time { return time.Date(2026, 3, 13, 12, 0, 0, 0, time.UTC) },
	})

	token, err := manager.Create(User{
		ID:    "user-123",
		Email: "user@example.com",
	})
	if err != nil {
		t.Fatalf("create token: %v", err)
	}

	_, err = manager.Parse(token + "tampered")
	if !errors.Is(err, ErrSessionInvalid) {
		t.Fatalf("expected ErrSessionInvalid, got %v", err)
	}
	if !strings.Contains(err.Error(), "invalid session") {
		t.Fatalf("expected invalid session details, got %v", err)
	}
}
