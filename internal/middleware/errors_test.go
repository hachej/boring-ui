package middleware_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	apppkg "github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/config"
)

type panicModule struct {
	path string
	err  any
}

func (m panicModule) Name() string { return m.path }

func (m panicModule) RegisterRoutes(router apppkg.Router) {
	router.Method(http.MethodGet, m.path, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(m.err)
	}))
}

func TestPanicReturns500JSONEnvelope(t *testing.T) {
	app := apppkg.New(config.Config{})
	app.AddModule(panicModule{path: "/panic", err: "boom"})

	req := httptest.NewRequest(http.MethodGet, "/panic", nil)
	req.Header.Set("X-Request-ID", "req-panic")
	rec := httptest.NewRecorder()
	app.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}

	var payload map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["code"] != "internal_error" {
		t.Fatalf("expected internal_error code, got %q", payload["code"])
	}
	if payload["request_id"] != "req-panic" {
		t.Fatalf("expected request_id req-panic, got %q", payload["request_id"])
	}
}

func TestTypedAPIErrorUsesDeclaredStatusAndMessage(t *testing.T) {
	app := apppkg.New(config.Config{})
	app.AddModule(panicModule{
		path: "/api-error",
		err: apppkg.APIError{
			Status:  http.StatusForbidden,
			Code:    "forbidden",
			Message: "nope",
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/api-error", nil)
	req.Header.Set("X-Request-ID", "req-typed")
	rec := httptest.NewRecorder()
	app.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}

	var payload map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["code"] != "forbidden" {
		t.Fatalf("expected forbidden code, got %q", payload["code"])
	}
	if payload["message"] != "nope" {
		t.Fatalf("expected nope message, got %q", payload["message"])
	}
	if payload["request_id"] != "req-typed" {
		t.Fatalf("expected request_id req-typed, got %q", payload["request_id"])
	}
}
