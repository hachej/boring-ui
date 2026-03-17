package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	DefaultCookieName = "boring_session"
	DefaultSessionTTL = 7 * 24 * time.Hour
	clockSkewLeeway   = 30 * time.Second
)

var (
	ErrSessionInvalid = errors.New("invalid session")
	ErrSessionExpired = errors.New("expired session")
)

type SessionConfig struct {
	CookieName string
	Secret     string
	TTL        time.Duration
	Secure     bool
	Now        func() time.Time
}

type sessionClaims struct {
	Email   string `json:"email"`
	IsOwner bool   `json:"is_owner"`
	jwt.RegisteredClaims
}

// SessionManager issues and validates boring_session HS256 cookies.
type SessionManager struct {
	cookieName string
	secret     []byte
	ttl        time.Duration
	secure     bool
	now        func() time.Time
}

func NewSessionManager(cfg SessionConfig) *SessionManager {
	cookieName := strings.TrimSpace(cfg.CookieName)
	if cookieName == "" {
		cookieName = DefaultCookieName
	}

	ttl := cfg.TTL
	if ttl <= 0 {
		ttl = DefaultSessionTTL
	}

	now := cfg.Now
	if now == nil {
		now = time.Now
	}

	secret := strings.TrimSpace(cfg.Secret)
	if secret == "" {
		secret = randomSecret()
	}

	return &SessionManager{
		cookieName: cookieName,
		secret:     []byte(secret),
		ttl:        ttl,
		secure:     cfg.Secure,
		now:        now,
	}
}

func (m *SessionManager) CookieName() string {
	return m.cookieName
}

func (m *SessionManager) Create(user User) (string, error) {
	now := m.now().UTC()
	claims := sessionClaims{
		Email:   normalizeEmail(user.Email),
		IsOwner: user.IsOwner,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strings.TrimSpace(user.ID),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(m.ttl)),
		},
	}
	if claims.Subject == "" || claims.Email == "" {
		return "", fmt.Errorf("%w: subject and email are required", ErrSessionInvalid)
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.secret)
}

func (m *SessionManager) Parse(raw string) (AuthContext, error) {
	if strings.TrimSpace(raw) == "" {
		return AuthContext{}, fmt.Errorf("%w: empty token", ErrSessionInvalid)
	}

	claims := &sessionClaims{}
	token, err := jwt.ParseWithClaims(
		raw,
		claims,
		func(token *jwt.Token) (any, error) {
			method := ""
			if token.Method != nil {
				method = token.Method.Alg()
			}
			if method != jwt.SigningMethodHS256.Alg() {
				return nil, fmt.Errorf("unexpected signing method %q", method)
			}
			return m.secret, nil
		},
		jwt.WithLeeway(clockSkewLeeway),
		jwt.WithTimeFunc(m.now),
	)
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return AuthContext{}, fmt.Errorf("%w: %v", ErrSessionExpired, err)
		}
		return AuthContext{}, fmt.Errorf("%w: %v", ErrSessionInvalid, err)
	}
	if token == nil || !token.Valid {
		return AuthContext{}, fmt.Errorf("%w: token is not valid", ErrSessionInvalid)
	}
	if strings.TrimSpace(claims.Subject) == "" || normalizeEmail(claims.Email) == "" {
		return AuthContext{}, fmt.Errorf("%w: missing required claims", ErrSessionInvalid)
	}

	return AuthContext{
		UserID:    claims.Subject,
		Email:     normalizeEmail(claims.Email),
		IsOwner:   claims.IsOwner,
		ExpiresAt: claims.ExpiresAt.Time.Unix(),
	}, nil
}

func (m *SessionManager) SetCookie(w http.ResponseWriter, user User) error {
	token, err := m.Create(user)
	if err != nil {
		return err
	}

	http.SetCookie(w, &http.Cookie{
		Name:     m.cookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(m.ttl.Seconds()),
		Expires:  m.now().UTC().Add(m.ttl),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   m.secure,
	})
	return nil
}

func (m *SessionManager) ClearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     m.cookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(0, 0).UTC(),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   m.secure,
	})
}

func SessionSecretFromEnv() string {
	if secret := strings.TrimSpace(os.Getenv("BORING_UI_SESSION_SECRET")); secret != "" {
		return secret
	}
	return strings.TrimSpace(os.Getenv("BORING_SESSION_SECRET"))
}

func randomSecret() string {
	var buf [32]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf[:])
}
