package auth

import (
	"errors"
	"strings"
)

var ErrMissingAccessToken = errors.New("access_token is required")

type TokenExchangeRequest struct {
	AccessToken  string `json:"access_token"`
	SessionToken string `json:"session_token"`
	RedirectURI  string `json:"redirect_uri"`
}

func (r TokenExchangeRequest) Token() string {
	if token := strings.TrimSpace(r.AccessToken); token != "" {
		return token
	}
	return strings.TrimSpace(r.SessionToken)
}

func ExchangeToken(verifier *TokenVerifier, rawToken string) (User, error) {
	if strings.TrimSpace(rawToken) == "" {
		return User{}, ErrMissingAccessToken
	}
	if verifier == nil {
		return User{}, ErrTokenVerifierNotConfigured
	}
	return verifier.Verify(rawToken)
}
