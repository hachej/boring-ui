package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestTokenVerifierVerifiesEdDSATokensAndCachesJWKS(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate Ed25519 keypair: %v", err)
	}

	jwksServer, hits := newTestJWKSHandler(t, "kid-1", publicKey)
	defer jwksServer.Close()

	now := time.Date(2026, 3, 16, 7, 30, 0, 0, time.UTC)
	currentTime := now
	verifier := NewTokenVerifier(TokenVerifierConfig{
		NeonBaseURL: "https://example.neonauth.test/neondb/auth",
		NeonJWKSURL: jwksServer.URL,
		Now:         func() time.Time { return currentTime },
	})

	token := signTestEdDSAToken(t, privateKey, "kid-1", "https://example.neonauth.test", now.Add(3*time.Hour))
	user, err := verifier.Verify(token)
	if err != nil {
		t.Fatalf("verify token: %v", err)
	}
	if user.ID != "user-neon-1" {
		t.Fatalf("expected user id to round-trip, got %q", user.ID)
	}
	if user.Email != "owner@example.com" {
		t.Fatalf("expected email to round-trip, got %q", user.Email)
	}
	if got := atomic.LoadInt32(hits); got != 1 {
		t.Fatalf("expected one JWKS fetch, got %d", got)
	}

	currentTime = currentTime.Add(59 * time.Minute)
	if _, err := verifier.Verify(token); err != nil {
		t.Fatalf("verify cached token: %v", err)
	}
	if got := atomic.LoadInt32(hits); got != 1 {
		t.Fatalf("expected JWKS cache hit within TTL, got %d fetches", got)
	}

	currentTime = currentTime.Add(2 * time.Minute)
	if _, err := verifier.Verify(token); err != nil {
		t.Fatalf("verify after cache ttl: %v", err)
	}
	if got := atomic.LoadInt32(hits); got != 2 {
		t.Fatalf("expected JWKS cache refresh after TTL, got %d fetches", got)
	}
}

func TestTokenVerifierRejectsBadEdDSASignature(t *testing.T) {
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate Ed25519 keypair: %v", err)
	}
	_, wrongPrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate wrong Ed25519 keypair: %v", err)
	}

	jwksServer, _ := newTestJWKSHandler(t, "kid-2", publicKey)
	defer jwksServer.Close()

	now := time.Date(2026, 3, 16, 8, 0, 0, 0, time.UTC)
	verifier := NewTokenVerifier(TokenVerifierConfig{
		NeonBaseURL: "https://example.neonauth.test/neondb/auth",
		NeonJWKSURL: jwksServer.URL,
		Now:         func() time.Time { return now },
	})

	token := signTestEdDSAToken(t, wrongPrivateKey, "kid-2", "https://example.neonauth.test", now.Add(time.Hour))
	if _, err := verifier.Verify(token); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("expected ErrTokenInvalid, got %v", err)
	}
}

func TestTokenVerifierRefreshesJWKSWhenKidRotatesWithinTTL(t *testing.T) {
	publicKeyA, privateKeyA, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate initial Ed25519 keypair: %v", err)
	}
	publicKeyB, privateKeyB, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate rotated Ed25519 keypair: %v", err)
	}

	var (
		hits       int32
		mu         sync.Mutex
		currentKid = "kid-a"
		currentKey = publicKeyA
	)
	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		mu.Lock()
		kid := currentKid
		publicKey := append(ed25519.PublicKey(nil), currentKey...)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]string{
				{
					"kty": "OKP",
					"crv": "Ed25519",
					"alg": "EdDSA",
					"kid": kid,
					"x":   base64.RawURLEncoding.EncodeToString(publicKey),
				},
			},
		})
	}))
	defer jwksServer.Close()

	now := time.Date(2026, 3, 16, 8, 5, 0, 0, time.UTC)
	currentTime := now
	verifier := NewTokenVerifier(TokenVerifierConfig{
		NeonBaseURL: "https://example.neonauth.test/neondb/auth",
		NeonJWKSURL: jwksServer.URL,
		Now:         func() time.Time { return currentTime },
	})

	tokenA := signTestEdDSAToken(t, privateKeyA, "kid-a", "https://example.neonauth.test", now.Add(3*time.Hour))
	if _, err := verifier.Verify(tokenA); err != nil {
		t.Fatalf("verify initial token: %v", err)
	}
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("expected one initial JWKS fetch, got %d", got)
	}

	mu.Lock()
	currentKid = "kid-b"
	currentKey = publicKeyB
	mu.Unlock()
	currentTime = currentTime.Add(10 * time.Minute)

	tokenB := signTestEdDSAToken(t, privateKeyB, "kid-b", "https://example.neonauth.test", now.Add(3*time.Hour))
	user, err := verifier.Verify(tokenB)
	if err != nil {
		t.Fatalf("verify rotated token: %v", err)
	}
	if user.ID != "user-neon-1" {
		t.Fatalf("expected rotated token user id, got %q", user.ID)
	}
	if got := atomic.LoadInt32(&hits); got != 2 {
		t.Fatalf("expected JWKS refresh on new kid, got %d fetches", got)
	}
}

func TestTokenVerifierRejectsExpiredEdDSAToken(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate Ed25519 keypair: %v", err)
	}

	jwksServer, _ := newTestJWKSHandler(t, "kid-3", publicKey)
	defer jwksServer.Close()

	now := time.Date(2026, 3, 16, 8, 15, 0, 0, time.UTC)
	verifier := NewTokenVerifier(TokenVerifierConfig{
		NeonBaseURL: "https://example.neonauth.test/neondb/auth",
		NeonJWKSURL: jwksServer.URL,
		Now:         func() time.Time { return now },
	})

	token := signTestEdDSAToken(t, privateKey, "kid-3", "https://example.neonauth.test", now.Add(-time.Minute))
	if _, err := verifier.Verify(token); !errors.Is(err, ErrTokenExpired) {
		t.Fatalf("expected ErrTokenExpired, got %v", err)
	}
}

func TestTokenVerifierAllowsHS256FallbackInLocalMode(t *testing.T) {
	now := time.Date(2026, 3, 16, 8, 30, 0, 0, time.UTC)
	manager := NewSessionManager(SessionConfig{
		Secret: "local-secret",
		TTL:    DefaultSessionTTL,
		Now:    func() time.Time { return now },
	})

	token, err := manager.Create(User{
		ID:      "local-user-1",
		Email:   "Owner@Example.com",
		IsOwner: true,
	})
	if err != nil {
		t.Fatalf("create session token: %v", err)
	}

	verifier := NewTokenVerifier(TokenVerifierConfig{
		SessionSecret: "local-secret",
		Now:           func() time.Time { return now },
	})
	user, err := verifier.Verify(token)
	if err != nil {
		t.Fatalf("verify hs256 fallback token: %v", err)
	}
	if user.ID != "local-user-1" {
		t.Fatalf("expected local user id, got %q", user.ID)
	}
	if user.Email != "owner@example.com" {
		t.Fatalf("expected normalized local email, got %q", user.Email)
	}
	if !user.IsOwner {
		t.Fatal("expected owner bit to round-trip")
	}
}

func newTestJWKSHandler(t *testing.T, kid string, publicKey ed25519.PublicKey) (*httptest.Server, *int32) {
	t.Helper()

	var hits int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]string{
				{
					"kty": "OKP",
					"crv": "Ed25519",
					"alg": "EdDSA",
					"kid": kid,
					"x":   base64.RawURLEncoding.EncodeToString(publicKey),
				},
			},
		})
	}))

	return server, &hits
}

func signTestEdDSAToken(t *testing.T, privateKey ed25519.PrivateKey, kid, audience string, expiresAt time.Time) string {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, jwt.MapClaims{
		"sub":   "user-neon-1",
		"email": "owner@example.com",
		"aud":   audience,
		"exp":   expiresAt.Unix(),
	})
	token.Header["kid"] = kid

	raw, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatalf("sign EdDSA token: %v", err)
	}
	return raw
}
