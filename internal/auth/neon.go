package auth

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const jwksCacheTTL = time.Hour

var errJWKSKeyNotFound = errors.New("jwks key not found")

type NeonVerifierConfig struct {
	BaseURL    string
	JWKSURL    string
	HTTPClient *http.Client
	Now        func() time.Time
}

type NeonVerifier struct {
	jwksURL  string
	audience string
	client   *http.Client
	cache    *jwksCache
	now      func() time.Time
}

type jwksCache struct {
	mu      sync.Mutex
	entries map[string]jwksCacheEntry
}

type jwksCacheEntry struct {
	keys      map[string]ed25519.PublicKey
	singleKey ed25519.PublicKey
	expiresAt time.Time
}

type jwksDocument struct {
	Keys []jwkKey `json:"keys"`
}

type jwkKey struct {
	Alg string `json:"alg"`
	Crv string `json:"crv"`
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	X   string `json:"x"`
}

var defaultJWKSCache = &jwksCache{entries: make(map[string]jwksCacheEntry)}

func NewNeonVerifier(cfg NeonVerifierConfig) *NeonVerifier {
	now := cfg.Now
	if now == nil {
		now = time.Now
	}

	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}

	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	jwksURL := strings.TrimSpace(cfg.JWKSURL)
	if jwksURL == "" && baseURL != "" {
		jwksURL = baseURL + "/.well-known/jwks.json"
	}

	return &NeonVerifier{
		jwksURL:  jwksURL,
		audience: neonAudience(baseURL),
		client:   client,
		cache:    defaultJWKSCache,
		now:      now,
	}
}

func (v *NeonVerifier) Verify(raw string) (User, error) {
	if v == nil || strings.TrimSpace(v.jwksURL) == "" || strings.TrimSpace(v.audience) == "" {
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
			if method != jwt.SigningMethodEdDSA.Alg() {
				return nil, fmt.Errorf("%w: unexpected signing method %q", ErrTokenInvalid, method)
			}

			kid, _ := token.Header["kid"].(string)
			key, lookupErr := v.cache.lookup(v.client, v.jwksURL, kid, v.now())
			if lookupErr != nil {
				return nil, lookupErr
			}
			return key, nil
		},
		jwt.WithAudience(v.audience),
		jwt.WithLeeway(clockSkewLeeway),
		jwt.WithTimeFunc(v.now),
	)
	if err != nil {
		if errors.Is(err, ErrTokenVerifierUnavailable) || strings.Contains(err.Error(), ErrTokenVerifierUnavailable.Error()) {
			return User{}, fmt.Errorf("%w: %v", ErrTokenVerifierUnavailable, err)
		}
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

func neonAudience(baseURL string) string {
	if baseURL == "" {
		return ""
	}

	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}

	return parsed.Scheme + "://" + parsed.Host
}

func (c *jwksCache) lookup(client *http.Client, jwksURL, kid string, now time.Time) (ed25519.PublicKey, error) {
	c.mu.Lock()
	entry, ok := c.entries[jwksURL]
	c.mu.Unlock()
	if ok && now.Before(entry.expiresAt) {
		key, err := selectJWK(entry, kid)
		if err == nil || !errors.Is(err, errJWKSKeyNotFound) {
			return key, err
		}
	}

	entry, err := fetchJWKS(client, jwksURL)
	if err != nil {
		return nil, err
	}
	entry.expiresAt = now.Add(jwksCacheTTL)

	c.mu.Lock()
	c.entries[jwksURL] = entry
	c.mu.Unlock()

	return selectJWK(entry, kid)
}

func fetchJWKS(client *http.Client, jwksURL string) (jwksCacheEntry, error) {
	req, err := http.NewRequest(http.MethodGet, jwksURL, nil)
	if err != nil {
		return jwksCacheEntry{}, fmt.Errorf("%w: build request: %v", ErrTokenVerifierUnavailable, err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return jwksCacheEntry{}, fmt.Errorf("%w: fetch jwks: %v", ErrTokenVerifierUnavailable, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return jwksCacheEntry{}, fmt.Errorf("%w: jwks returned %d", ErrTokenVerifierUnavailable, resp.StatusCode)
	}

	var doc jwksDocument
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return jwksCacheEntry{}, fmt.Errorf("%w: decode jwks: %v", ErrTokenVerifierUnavailable, err)
	}

	entry := jwksCacheEntry{keys: make(map[string]ed25519.PublicKey, len(doc.Keys))}
	for _, key := range doc.Keys {
		if key.Kty != "OKP" || key.Crv != "Ed25519" || strings.TrimSpace(key.X) == "" {
			continue
		}

		decoded, err := base64.RawURLEncoding.DecodeString(key.X)
		if err != nil {
			return jwksCacheEntry{}, fmt.Errorf("%w: decode jwks key %q: %v", ErrTokenVerifierUnavailable, key.Kid, err)
		}
		if len(decoded) != ed25519.PublicKeySize {
			return jwksCacheEntry{}, fmt.Errorf("%w: invalid Ed25519 key length for %q", ErrTokenVerifierUnavailable, key.Kid)
		}

		publicKey := ed25519.PublicKey(decoded)
		if key.Kid != "" {
			entry.keys[key.Kid] = publicKey
		}
		if entry.singleKey == nil {
			entry.singleKey = publicKey
		}
	}

	if len(entry.keys) == 0 && entry.singleKey == nil {
		return jwksCacheEntry{}, fmt.Errorf("%w: jwks does not contain Ed25519 keys", ErrTokenVerifierUnavailable)
	}

	return entry, nil
}

func selectJWK(entry jwksCacheEntry, kid string) (ed25519.PublicKey, error) {
	if kid != "" {
		key, ok := entry.keys[kid]
		if !ok {
			return nil, fmt.Errorf("%w: %w: %q", ErrTokenInvalid, errJWKSKeyNotFound, kid)
		}
		return key, nil
	}
	if entry.singleKey != nil {
		return entry.singleKey, nil
	}
	return nil, fmt.Errorf("%w: token is missing kid", ErrTokenInvalid)
}
