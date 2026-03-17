package ws

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type stubConn struct {
	mu     sync.Mutex
	closed bool
	writes [][]byte
	err    error
	delay  time.Duration
}

func (s *stubConn) WriteMessage(_ int, data []byte) error {
	if s.delay > 0 {
		time.Sleep(s.delay)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return s.err
	}
	s.writes = append(s.writes, append([]byte(nil), data...))
	return nil
}

func (s *stubConn) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	return nil
}

func TestRegistryBroadcastFansOutToAllConnections(t *testing.T) {
	t.Parallel()

	registry := NewRegistry(10)
	first := &stubConn{}
	second := &stubConn{}

	if err := registry.Register("session-1", first); err != nil {
		t.Fatalf("register first: %v", err)
	}
	if err := registry.Register("session-1", second); err != nil {
		t.Fatalf("register second: %v", err)
	}

	if err := registry.Broadcast("session-1", TextMessage([]byte("hello"))); err != nil {
		t.Fatalf("broadcast: %v", err)
	}

	if got := len(first.writes); got != 1 || string(first.writes[0]) != "hello" {
		t.Fatalf("unexpected first writes: %#v", first.writes)
	}
	if got := len(second.writes); got != 1 || string(second.writes[0]) != "hello" {
		t.Fatalf("unexpected second writes: %#v", second.writes)
	}
}

func TestRegistryBroadcastRunsFanOutConcurrently(t *testing.T) {
	t.Parallel()

	registry := NewRegistry(10)
	for i := 0; i < 3; i++ {
		if err := registry.Register("session-1", &stubConn{delay: 50 * time.Millisecond}); err != nil {
			t.Fatalf("register conn %d: %v", i, err)
		}
	}

	start := time.Now()
	if err := registry.Broadcast("session-1", TextMessage([]byte("hello"))); err != nil {
		t.Fatalf("broadcast: %v", err)
	}
	if elapsed := time.Since(start); elapsed >= 120*time.Millisecond {
		t.Fatalf("expected concurrent fan-out, broadcast took %s", elapsed)
	}
}

func TestRegistryDeregisterRemovesEmptySession(t *testing.T) {
	t.Parallel()

	registry := NewRegistry(10)
	conn := &stubConn{}
	if err := registry.Register("session-1", conn); err != nil {
		t.Fatalf("register: %v", err)
	}

	registry.Deregister("session-1", conn)

	if got := registry.Connections("session-1"); got != 0 {
		t.Fatalf("expected no connections, got %d", got)
	}
	if got := registry.SessionCount(); got != 0 {
		t.Fatalf("expected no sessions, got %d", got)
	}
	if got := registry.InUse(); got != 0 {
		t.Fatalf("expected no leased connections, got %d", got)
	}
}

func TestRegistryBroadcastDropsFailedConnection(t *testing.T) {
	t.Parallel()

	registry := NewRegistry(10)
	good := &stubConn{}
	bad := &stubConn{err: errors.New("boom")}
	if err := registry.Register("session-1", good); err != nil {
		t.Fatalf("register good: %v", err)
	}
	if err := registry.Register("session-1", bad); err != nil {
		t.Fatalf("register bad: %v", err)
	}

	err := registry.Broadcast("session-1", TextMessage([]byte("hello")))
	if err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("expected joined broadcast error, got %v", err)
	}
	if got := registry.Connections("session-1"); got != 1 {
		t.Fatalf("expected failed peer to be removed, got %d connections", got)
	}
	if !bad.closed {
		t.Fatal("expected failed peer to be closed")
	}
}

func TestRegistryCapacityLimitRejects101stRegister(t *testing.T) {
	t.Parallel()

	registry := NewRegistry(100)
	var wg sync.WaitGroup
	errs := make(chan error, 101)

	for i := 0; i < 101; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs <- registry.Register("session-1", &stubConn{})
		}(i)
	}
	wg.Wait()
	close(errs)

	var successCount int
	var capacityCount int
	for err := range errs {
		switch {
		case err == nil:
			successCount++
		case errors.Is(err, ErrAtCapacity):
			capacityCount++
		default:
			t.Fatalf("unexpected register error: %v", err)
		}
	}

	if successCount != 100 {
		t.Fatalf("expected 100 successful registrations, got %d", successCount)
	}
	if capacityCount != 1 {
		t.Fatalf("expected one capacity error, got %d", capacityCount)
	}
}

func TestWriteCapacityErrorReturns503(t *testing.T) {
	t.Parallel()

	rec := httptest.NewRecorder()
	WriteCapacityError(rec)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), ErrAtCapacity.Error()) {
		t.Fatalf("expected body to mention %q, got %q", ErrAtCapacity.Error(), rec.Body.String())
	}
}

func TestConnClosesAfterThreeMissedPongs(t *testing.T) {
	done := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
		raw, err := upgrader.Upgrade(w, req, nil)
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		conn := NewConn(
			raw,
			WithPingInterval(20*time.Millisecond),
			WithPongWait(20*time.Millisecond),
			WithWriteWait(20*time.Millisecond),
			WithMaxMissedPongs(3),
		)
		<-conn.Done()
		close(done)
	}))
	defer server.Close()

	url := "ws" + strings.TrimPrefix(server.URL, "http")
	client, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer client.Close()

	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected server websocket wrapper to close after missed pongs")
	}
}
