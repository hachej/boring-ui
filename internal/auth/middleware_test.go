package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMiddlewareAddsAuthContextForProtectedRoutes(t *testing.T) {
	manager := NewSessionManager(SessionConfig{
		Secret: "test-secret",
		TTL:    DefaultSessionTTL,
		Now:    func() time.Time { return time.Date(2026, 3, 13, 12, 0, 0, 0, time.UTC) },
	})
	token, err := manager.Create(User{
		ID:      "user-123",
		Email:   "user@example.com",
		IsOwner: true,
	})
	if err != nil {
		t.Fatalf("create token: %v", err)
	}

	handler := NewMiddleware(MiddlewareConfig{SessionManager: manager})(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		authCtx, ok := ContextFromRequest(req)
		if !ok {
			t.Fatal("expected auth context in request")
		}
		if authCtx.UserID != "user-123" {
			t.Fatalf("expected user id from cookie, got %q", authCtx.UserID)
		}
		if authCtx.Email != "user@example.com" {
			t.Fatalf("expected email from cookie, got %q", authCtx.Email)
		}
		if !authCtx.IsOwner {
			t.Fatal("expected owner flag from cookie")
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.AddCookie(&http.Cookie{Name: manager.CookieName(), Value: token})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected request to reach handler, got %d", rec.Code)
	}
}

func TestMiddlewareAddsAuthContextForBoundaryRoutes(t *testing.T) {
	manager := NewSessionManager(SessionConfig{
		Secret: "test-secret",
		TTL:    DefaultSessionTTL,
		Now:    func() time.Time { return time.Date(2026, 3, 13, 12, 0, 0, 0, time.UTC) },
	})
	token, err := manager.Create(User{
		ID:      "user-123",
		Email:   "user@example.com",
		IsOwner: true,
	})
	if err != nil {
		t.Fatalf("create token: %v", err)
	}

	handler := NewMiddleware(MiddlewareConfig{SessionManager: manager})(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if _, ok := ContextFromRequest(req); !ok {
			t.Fatal("expected auth context in boundary request")
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/w/workspace-1/settings", nil)
	req.AddCookie(&http.Cookie{Name: manager.CookieName(), Value: token})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected boundary request to reach handler, got %d", rec.Code)
	}
}

func TestMiddlewareRejectsMissingCookie(t *testing.T) {
	manager := NewSessionManager(SessionConfig{Secret: "test-secret"})
	handler := NewMiddleware(MiddlewareConfig{SessionManager: manager})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("handler should not run without auth")
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}

	var payload map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["code"] != "unauthorized" {
		t.Fatalf("expected unauthorized code, got %q", payload["code"])
	}
}

func TestMiddlewareRejectsInvalidCookie(t *testing.T) {
	manager := NewSessionManager(SessionConfig{Secret: "test-secret"})
	handler := NewMiddleware(MiddlewareConfig{SessionManager: manager})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("handler should not run with invalid auth")
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.AddCookie(&http.Cookie{Name: manager.CookieName(), Value: "not-a-jwt"})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}
