package auth

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrTokenInvalid               = errors.New("invalid access token")
	ErrTokenExpired               = errors.New("expired access token")
	ErrTokenVerifierNotConfigured = errors.New("token verifier is not configured")
	ErrTokenVerifierUnavailable   = errors.New("token verifier unavailable")
)

type TokenVerifierConfig struct {
	SessionSecret string
	NeonBaseURL   string
	NeonJWKSURL   string
	HTTPClient    *http.Client
	Now           func() time.Time
}

type TokenVerifier struct {
	hs256Secret []byte
	neon        *NeonVerifier
	now         func() time.Time
}

type tokenHeader struct {
	Alg string `json:"alg"`
	Kid string `json:"kid"`
}

func NewTokenVerifier(cfg TokenVerifierConfig) *TokenVerifier {
	now := cfg.Now
	if now == nil {
		now = time.Now
	}

	verifier := &TokenVerifier{
		hs256Secret: []byte(strings.TrimSpace(cfg.SessionSecret)),
		now:         now,
	}
	if strings.TrimSpace(cfg.NeonBaseURL) != "" || strings.TrimSpace(cfg.NeonJWKSURL) != "" {
		verifier.neon = NewNeonVerifier(NeonVerifierConfig{
			BaseURL:    cfg.NeonBaseURL,
			JWKSURL:    cfg.NeonJWKSURL,
			HTTPClient: cfg.HTTPClient,
			Now:        now,
		})
	}

	return verifier
}

func (v *TokenVerifier) Verify(raw string) (User, error) {
	header, err := decodeTokenHeader(raw)
	if err != nil {
		return User{}, err
	}

	switch header.Alg {
	case jwt.SigningMethodHS256.Alg():
		return v.verifyHS256(raw)
	case jwt.SigningMethodEdDSA.Alg():
		if v == nil || v.neon == nil {
			return User{}, ErrTokenVerifierNotConfigured
		}
		return v.neon.Verify(raw)
	default:
		return User{}, fmt.Errorf("%w: unsupported algorithm %q", ErrTokenInvalid, header.Alg)
	}
}

func (v *TokenVerifier) verifyHS256(raw string) (User, error) {
	if v == nil || len(v.hs256Secret) == 0 {
		return User{}, ErrTokenVerifierNotConfigured
	}

	claims := jwt.MapClaims{}
	parsed, err := jwt.ParseWithClaims(
		raw,
		claims,
		func(token *jwt.Token) (any, error) {
			method := ""
			if token.Method != nil {
				method = token.Method.Alg()
			}
			if method != jwt.SigningMethodHS256.Alg() {
				return nil, fmt.Errorf("%w: unexpected signing method %q", ErrTokenInvalid, method)
			}
			return v.hs256Secret, nil
		},
		jwt.WithLeeway(clockSkewLeeway),
		jwt.WithTimeFunc(v.now),
	)
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return User{}, fmt.Errorf("%w: %v", ErrTokenExpired, err)
		}
		return User{}, fmt.Errorf("%w: %v", ErrTokenInvalid, err)
	}
	if parsed == nil || !parsed.Valid {
		return User{}, fmt.Errorf("%w: token is not valid", ErrTokenInvalid)
	}

	return userFromClaims(claims)
}

func decodeTokenHeader(raw string) (tokenHeader, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return tokenHeader{}, fmt.Errorf("%w: empty token", ErrTokenInvalid)
	}

	parts := strings.Split(trimmed, ".")
	if len(parts) != 3 {
		return tokenHeader{}, fmt.Errorf("%w: malformed jwt", ErrTokenInvalid)
	}

	decoded, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return tokenHeader{}, fmt.Errorf("%w: decode header: %v", ErrTokenInvalid, err)
	}

	var header tokenHeader
	if err := json.Unmarshal(decoded, &header); err != nil {
		return tokenHeader{}, fmt.Errorf("%w: parse header: %v", ErrTokenInvalid, err)
	}
	if strings.TrimSpace(header.Alg) == "" {
		return tokenHeader{}, fmt.Errorf("%w: missing alg header", ErrTokenInvalid)
	}

	return header, nil
}

func userFromClaims(claims jwt.MapClaims) (User, error) {
	sub, _ := claims["sub"].(string)
	email, _ := claims["email"].(string)
	sub = strings.TrimSpace(sub)
	email = normalizeEmail(email)
	if sub == "" {
		return User{}, fmt.Errorf("%w: missing sub claim", ErrTokenInvalid)
	}
	if email == "" {
		return User{}, fmt.Errorf("%w: missing email claim", ErrTokenInvalid)
	}
	if _, ok := claims["exp"]; !ok {
		return User{}, fmt.Errorf("%w: missing exp claim", ErrTokenInvalid)
	}

	user := User{
		ID:    sub,
		Email: email,
	}
	if owner, ok := claims["is_owner"].(bool); ok {
		user.IsOwner = owner
	}

	return user, nil
}
