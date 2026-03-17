package plugins

import (
	"context"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"

	"github.com/boringdata/boring-ui/internal/auth"
)

type workspaceKey string

const workspaceContextKey workspaceKey = "workspace_id"

type PortLookup interface {
	Port(name string) (int, bool)
}

type Proxy struct {
	lookup PortLookup
	issuer *RequestSigner
}

type ProxyOption func(*Proxy)

func WithRequestSigner(issuer *RequestSigner) ProxyOption {
	return func(proxy *Proxy) {
		proxy.issuer = issuer
	}
}

func NewProxy(lookup PortLookup, options ...ProxyOption) *Proxy {
	proxy := &Proxy{lookup: lookup}
	for _, option := range options {
		if option != nil {
			option(proxy)
		}
	}
	return proxy
}

func WithWorkspaceID(ctx context.Context, workspaceID string) context.Context {
	return context.WithValue(ctx, workspaceContextKey, strings.TrimSpace(workspaceID))
}

func WorkspaceIDFromContext(ctx context.Context) (string, bool) {
	value, ok := ctx.Value(workspaceContextKey).(string)
	return strings.TrimSpace(value), ok && strings.TrimSpace(value) != ""
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	plugin, suffix, ok := splitPluginPath(req.URL.Path)
	if !ok {
		http.NotFound(w, req)
		return
	}

	port, ok := p.lookup.Port(plugin)
	if !ok || port == 0 {
		http.Error(w, "plugin unavailable", http.StatusServiceUnavailable)
		return
	}

	target := &url.URL{Scheme: "http", Host: "127.0.0.1:" + itoa(port)}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(proxyReq *httputil.ProxyRequest) {
			proxyReq.SetURL(target)
			proxyReq.Out.URL.Path = suffix
			proxyReq.Out.URL.RawQuery = req.URL.RawQuery
			proxyReq.Out.Host = target.Host
			userID := ""
			if authCtx, ok := auth.ContextFromRequest(req); ok && strings.TrimSpace(authCtx.UserID) != "" {
				userID = strings.TrimSpace(authCtx.UserID)
				proxyReq.Out.Header.Set(HeaderUserID, userID)
			}
			workspaceID := resolveWorkspaceID(req)
			if workspaceID != "" {
				proxyReq.Out.Header.Set(HeaderWorkspaceID, workspaceID)
			}
			if p.issuer != nil {
				if token, err := p.issuer.Issue(plugin, userID, workspaceID); err == nil && strings.TrimSpace(token) != "" {
					proxyReq.Out.Header.Set(HeaderAuth, token)
				}
			}
		},
		ErrorHandler: func(rw http.ResponseWriter, _ *http.Request, _ error) {
			http.Error(rw, "plugin unavailable", http.StatusBadGateway)
		},
	}
	proxy.ServeHTTP(w, req)
}

func splitPluginPath(path string) (string, string, bool) {
	trimmed := strings.TrimPrefix(path, "/")
	parts := strings.SplitN(trimmed, "/", 4)
	if len(parts) < 3 || parts[0] != "api" || parts[1] != "x" || strings.TrimSpace(parts[2]) == "" {
		return "", "", false
	}

	suffix := "/"
	if len(parts) == 4 {
		suffix += parts[3]
	}
	return parts[2], suffix, true
}

func itoa(value int) string {
	return strconv.Itoa(value)
}

func resolveWorkspaceID(req *http.Request) string {
	if workspaceID, ok := WorkspaceIDFromContext(req.Context()); ok {
		return workspaceID
	}
	return firstNonEmpty(
		req.Header.Get(HeaderWorkspaceID),
		req.Header.Get(IncomingWorkspaceIDHeader),
		req.URL.Query().Get("workspace_id"),
	)
}
