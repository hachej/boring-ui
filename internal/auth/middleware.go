package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type authContextKey string

const contextKey authContextKey = "auth_context"

// AuthContext is the request-scoped identity extracted from the session cookie.
type AuthContext struct {
	UserID    string `json:"user_id"`
	Email     string `json:"email"`
	IsOwner   bool   `json:"is_owner"`
	ExpiresAt int64  `json:"expires_at"`
}

type MiddlewareConfig struct {
	SessionManager    *SessionManager
	ProtectedPrefixes []string
	PublicPaths       []string
}

func ContextFromRequest(req *http.Request) (AuthContext, bool) {
	return ContextFromContext(req.Context())
}

func ContextFromContext(ctx context.Context) (AuthContext, bool) {
	value, ok := ctx.Value(contextKey).(AuthContext)
	return value, ok
}

func ContextWithAuth(ctx context.Context, authCtx AuthContext) context.Context {
	return context.WithValue(ctx, contextKey, authCtx)
}

func NewMiddleware(cfg MiddlewareConfig) func(http.Handler) http.Handler {
	prefixes := cfg.ProtectedPrefixes
	if len(prefixes) == 0 {
		prefixes = []string{"/api/", "/ws/", "/w/"}
	}
	publicPaths := make(map[string]struct{}, len(cfg.PublicPaths))
	for _, path := range cfg.PublicPaths {
		publicPaths[path] = struct{}{}
	}

	manager := cfg.SessionManager
	if manager == nil {
		return func(next http.Handler) http.Handler {
			return next
		}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if !requiresAuth(req.URL.Path, prefixes, publicPaths) {
				next.ServeHTTP(w, req)
				return
			}

			cookie, err := req.Cookie(manager.CookieName())
			if err != nil {
				writeUnauthorized(w, req, "missing session cookie")
				return
			}

			authCtx, err := manager.Parse(cookie.Value)
			if err != nil {
				message := "invalid session cookie"
				if errors.Is(err, ErrSessionExpired) {
					message = "expired session cookie"
				}
				writeUnauthorized(w, req, message)
				return
			}

			ctx := ContextWithAuth(req.Context(), authCtx)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	}
}

func requiresAuth(path string, prefixes []string, publicPaths map[string]struct{}) bool {
	if _, ok := publicPaths[path]; ok {
		return false
	}
	for _, prefix := range prefixes {
		if prefix != "" && strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

func writeUnauthorized(w http.ResponseWriter, req *http.Request, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	requestID := strings.TrimSpace(req.Header.Get("X-Request-ID"))
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":      "unauthorized",
		"code":       "unauthorized",
		"message":    message,
		"request_id": requestID,
	})
}
