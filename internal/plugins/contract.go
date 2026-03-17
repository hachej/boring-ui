package plugins

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	// Plugins receive identity and tenancy metadata on every proxied request.
	// X-Boring-Auth is a short-lived HS256 JWT signed with BORING_PLUGIN_AUTH_SECRET
	// and carries user_id, workspace_id, and plugin claims for trustable in-plugin auth.
	HeaderUserID              = "X-Boring-User-ID"
	HeaderWorkspaceID         = "X-Boring-Workspace-ID"
	HeaderAuth                = "X-Boring-Auth"
	IncomingWorkspaceIDHeader = "X-Workspace-ID"
	EnvAuthSecret             = "BORING_PLUGIN_AUTH_SECRET"
	EnvPluginName             = "BORING_PLUGIN_NAME"
	MessageTypePluginChanged  = "plugin_changed"
)

type LifecycleEventAction string

const (
	LifecycleEventAdd     LifecycleEventAction = "ADD"
	LifecycleEventRemove  LifecycleEventAction = "REMOVE"
	LifecycleEventRestart LifecycleEventAction = "RESTART"
)

// LifecycleEvent is the /ws/plugins payload for plugin discovery and restarts.
type LifecycleEvent struct {
	Type      string               `json:"type"`
	Event     LifecycleEventAction `json:"event"`
	Plugin    string               `json:"plugin"`
	Timestamp string               `json:"timestamp"`
}

// AuthClaims is the signed X-Boring-Auth payload forwarded to plugin subprocesses.
type AuthClaims struct {
	UserID      string `json:"user_id,omitempty"`
	WorkspaceID string `json:"workspace_id,omitempty"`
	Plugin      string `json:"plugin"`
	jwt.RegisteredClaims
}

type RequestSigner struct {
	secret string
	now    func() time.Time
	ttl    time.Duration
}

func NewRequestSigner(secret string) *RequestSigner {
	trimmed := strings.TrimSpace(secret)
	if trimmed == "" {
		trimmed = randomSecretHex(32)
	}
	return &RequestSigner{
		secret: trimmed,
		now:    time.Now,
		ttl:    2 * time.Minute,
	}
}

func (s *RequestSigner) SharedSecret() string {
	if s == nil {
		return ""
	}
	return s.secret
}

func (s *RequestSigner) Issue(plugin string, userID string, workspaceID string) (string, error) {
	if s == nil || strings.TrimSpace(s.secret) == "" {
		return "", errors.New("plugin signer is not configured")
	}

	now := s.now().UTC()
	claims := AuthClaims{
		UserID:      strings.TrimSpace(userID),
		WorkspaceID: strings.TrimSpace(workspaceID),
		Plugin:      strings.TrimSpace(plugin),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   firstNonEmpty(strings.TrimSpace(userID), "boring-ui-plugin-proxy"),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.ttl)),
		},
	}
	if claims.Plugin == "" {
		return "", errors.New("plugin is required")
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.secret))
}

func (s *RequestSigner) Verify(token string, expectedPlugin string) (AuthClaims, error) {
	if s == nil || strings.TrimSpace(s.secret) == "" {
		return AuthClaims{}, errors.New("plugin signer is not configured")
	}

	claims := &AuthClaims{}
	parsed, err := jwt.ParseWithClaims(
		token,
		claims,
		func(parsed *jwt.Token) (any, error) {
			method := ""
			if parsed.Method != nil {
				method = parsed.Method.Alg()
			}
			if method != jwt.SigningMethodHS256.Alg() {
				return nil, fmt.Errorf("unexpected signing method %q", method)
			}
			return []byte(s.secret), nil
		},
		jwt.WithLeeway(30*time.Second),
		jwt.WithTimeFunc(s.now),
	)
	if err != nil {
		return AuthClaims{}, err
	}
	if parsed == nil || !parsed.Valid {
		return AuthClaims{}, errors.New("plugin token is not valid")
	}
	if strings.TrimSpace(claims.Plugin) == "" {
		return AuthClaims{}, errors.New("plugin token missing plugin claim")
	}
	if trimmedExpected := strings.TrimSpace(expectedPlugin); trimmedExpected != "" && claims.Plugin != trimmedExpected {
		return AuthClaims{}, fmt.Errorf("unexpected plugin claim %q", claims.Plugin)
	}
	return *claims, nil
}

func NewLifecycleEvent(action LifecycleEventAction, plugin string) LifecycleEvent {
	return LifecycleEvent{
		Type:      MessageTypePluginChanged,
		Event:     action,
		Plugin:    strings.TrimSpace(plugin),
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
	}
}

func randomSecretHex(size int) string {
	if size <= 0 {
		size = 32
	}
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
