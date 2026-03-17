package stream

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

type stubSession struct {
	mu       sync.Mutex
	messages [][]byte
}

func (s *stubSession) Broadcast(payload []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.messages = append(s.messages, append([]byte(nil), payload...))
	return nil
}

func (s *stubSession) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.messages)
}

func (s *stubSession) Messages() [][]byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([][]byte, len(s.messages))
	for i, message := range s.messages {
		out[i] = append([]byte(nil), message...)
	}
	return out
}

func TestBridgeForwardsFrontendInputAndCLIOutput(t *testing.T) {
	t.Parallel()

	session := &stubSession{}
	logPath := filepath.Join(t.TempDir(), "stdin.log")
	bridge := NewBridge(session)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := bridge.Start(ctx, helperConfig(t, "echo-permission", logPath)); err != nil {
		t.Fatalf("start bridge: %v", err)
	}

	for i := 0; i < 10; i++ {
		payload := map[string]any{
			"type":    "user",
			"message": fmt.Sprintf("message-%d", i),
		}
		if i == 5 {
			payload = map[string]any{
				"type":       "permission_response",
				"request_id": "perm-1",
				"behavior":   "allow",
			}
		}
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal payload %d: %v", i, err)
		}
		if err := bridge.ForwardFrontend(raw); err != nil {
			t.Fatalf("forward payload %d: %v", i, err)
		}
	}

	waitForMessages(t, session, 10)

	if err := bridge.Wait(); err != nil {
		t.Fatalf("wait bridge: %v", err)
	}

	inputs := readHelperInputs(t, logPath)
	if len(inputs) != 10 {
		t.Fatalf("expected 10 stdin messages, got %d", len(inputs))
	}
	var sawPermissionResponse bool
	for _, input := range inputs {
		if input["type"] == "permission_response" {
			sawPermissionResponse = true
			break
		}
	}
	if !sawPermissionResponse {
		t.Fatal("expected permission_response to be written to subprocess stdin")
	}

	var sawPermissionRequest bool
	var sawAckForPermissionResponse bool
	for _, message := range session.Messages() {
		var payload map[string]any
		if err := json.Unmarshal(message, &payload); err != nil {
			t.Fatalf("decode broadcast payload: %v", err)
		}
		if payload["type"] == "permission_request" {
			sawPermissionRequest = true
		}
		if payload["type"] == "ack" && payload["echo_type"] == "permission_response" {
			sawAckForPermissionResponse = true
		}
	}
	if !sawPermissionRequest {
		t.Fatal("expected permission_request from subprocess to be forwarded")
	}
	if !sawAckForPermissionResponse {
		t.Fatal("expected subprocess ack for permission_response input")
	}
}

func TestBridgeCancelSendsSIGTERMThenKillsAfterDelay(t *testing.T) {
	t.Parallel()

	session := &stubSession{}
	bridge := NewBridge(session, WithKillDelay(50*time.Millisecond))

	ctx, cancel := context.WithCancel(context.Background())
	if err := bridge.Start(ctx, helperConfig(t, "ignore-term", "")); err != nil {
		t.Fatalf("start bridge: %v", err)
	}
	time.Sleep(25 * time.Millisecond)

	start := time.Now()
	cancel()

	if err := bridge.Wait(); err != nil {
		t.Fatalf("wait bridge after cancel: %v", err)
	}

	elapsed := time.Since(start)
	if elapsed < 40*time.Millisecond {
		t.Fatalf("expected graceful cancel delay before kill, got %s", elapsed)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("expected helper to be killed quickly after delay, got %s", elapsed)
	}
}

func TestBridgeHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return
	}

	switch os.Getenv("BRIDGE_HELPER_MODE") {
	case "echo-permission":
		runEchoPermissionHelper()
	case "ignore-term":
		runIgnoreTermHelper()
	default:
		os.Exit(2)
	}
}

func helperConfig(t *testing.T, mode string, logPath string) Config {
	t.Helper()

	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("resolve test executable: %v", err)
	}

	env := []string{
		"GO_WANT_HELPER_PROCESS=1",
		"BRIDGE_HELPER_MODE=" + mode,
	}
	if logPath != "" {
		env = append(env, "BRIDGE_HELPER_INPUT_LOG="+logPath)
	}

	return Config{
		Command: exe,
		Args:    []string{"-test.run=TestBridgeHelperProcess", "--"},
		Env:     env,
	}
}

func waitForMessages(t *testing.T, session *stubSession, want int) {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if session.Count() >= want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d broadcast messages, got %d", want, session.Count())
}

func readHelperInputs(t *testing.T, logPath string) []map[string]any {
	t.Helper()

	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read helper log: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	out := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(line), &payload); err != nil {
			t.Fatalf("decode helper input %q: %v", line, err)
		}
		out = append(out, payload)
	}
	return out
}

func runEchoPermissionHelper() {
	logPath := os.Getenv("BRIDGE_HELPER_INPUT_LOG")
	if logPath == "" {
		os.Exit(2)
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		os.Exit(2)
	}
	defer logFile.Close()

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for i := 0; i < 10 && scanner.Scan(); i++ {
		line := strings.TrimSpace(scanner.Text())
		if _, err := logFile.WriteString(line + "\n"); err != nil {
			os.Exit(3)
		}

		var payload map[string]any
		if err := json.Unmarshal([]byte(line), &payload); err != nil {
			os.Exit(4)
		}

		var out map[string]any
		if i == 0 {
			out = map[string]any{
				"type":       "permission_request",
				"request_id": "perm-1",
			}
		} else {
			out = map[string]any{
				"type":      "ack",
				"seq":       i + 1,
				"echo_type": payload["type"],
			}
		}
		raw, err := json.Marshal(out)
		if err != nil {
			os.Exit(5)
		}
		if _, err := fmt.Fprintln(os.Stdout, string(raw)); err != nil {
			os.Exit(6)
		}
	}
	if err := scanner.Err(); err != nil {
		os.Exit(7)
	}
	os.Exit(0)
}

func runIgnoreTermHelper() {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM)
	defer signal.Stop(signals)

	go func() {
		for range signals {
		}
	}()

	select {}
}
