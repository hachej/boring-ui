package plugins

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
)

type SupervisorConfig struct {
	Name           string
	Command        []string
	Dir            string
	Env            map[string]string
	Allocator      *PortAllocator
	BackoffBase    time.Duration
	BackoffCap     time.Duration
	MaxFailures    int
	StopTimeout    time.Duration
	StartupTimeout time.Duration
	HealthPath     string
	HealthRetries  int
}

type Supervisor struct {
	cfg    SupervisorConfig
	cancel context.CancelFunc
	done   chan struct{}

	restartCh chan struct{}

	stateMu syncState
}

type syncState struct {
	mu          sync.RWMutex
	currentPort int
	lastErr     error
	running     bool
}

func NewSupervisor(cfg SupervisorConfig) *Supervisor {
	if cfg.Allocator == nil {
		cfg.Allocator = NewPortAllocator()
	}
	if cfg.BackoffBase <= 0 {
		cfg.BackoffBase = 200 * time.Millisecond
	}
	if cfg.BackoffCap <= 0 {
		cfg.BackoffCap = 5 * time.Second
	}
	if cfg.MaxFailures <= 0 {
		cfg.MaxFailures = 5
	}
	if cfg.StopTimeout <= 0 {
		cfg.StopTimeout = 5 * time.Second
	}
	if cfg.StartupTimeout <= 0 {
		cfg.StartupTimeout = 2 * time.Second
	}
	if cfg.HealthPath == "" {
		cfg.HealthPath = "/health"
	}
	if cfg.HealthRetries == 0 {
		cfg.HealthRetries = 3
	}

	return &Supervisor{
		cfg:       cfg,
		done:      make(chan struct{}),
		restartCh: make(chan struct{}, 1),
	}
}

func (s *Supervisor) Start(ctx context.Context) error {
	if len(s.cfg.Command) == 0 {
		return errors.New("plugin command is required")
	}
	if s.cfg.Name == "" {
		return errors.New("plugin name is required")
	}

	runCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel

	go s.loop(runCtx)
	return nil
}

func (s *Supervisor) Stop(ctx context.Context) error {
	if s.cancel != nil {
		s.cancel()
	}
	select {
	case <-s.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Supervisor) Restart() {
	select {
	case s.restartCh <- struct{}{}:
	default:
	}
}

func (s *Supervisor) CurrentPort() int {
	s.stateMu.mu.RLock()
	defer s.stateMu.mu.RUnlock()
	return s.stateMu.currentPort
}

func (s *Supervisor) LastError() error {
	s.stateMu.mu.RLock()
	defer s.stateMu.mu.RUnlock()
	return s.stateMu.lastErr
}

func (s *Supervisor) loop(ctx context.Context) {
	defer close(s.done)

	failures := 0
	for {
		select {
		case <-ctx.Done():
			s.stateMu.set(0, false, ctx.Err())
			return
		default:
		}

		port, err := s.cfg.Allocator.Acquire(s.cfg.Name)
		if err != nil {
			s.stateMu.set(0, false, err)
			return
		}

		cmd := exec.Command(s.cfg.Command[0], s.cfg.Command[1:]...)
		cmd.Dir = s.cfg.Dir
		cmd.Env = append(os.Environ(), fmt.Sprintf("PORT=%d", port))
		for key, value := range s.cfg.Env {
			cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", key, value))
		}
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

		if err := cmd.Start(); err != nil {
			s.cfg.Allocator.Release(s.cfg.Name)
			s.stateMu.set(0, false, err)
			return
		}

		waitCh := make(chan error, 1)
		go func() {
			waitCh <- cmd.Wait()
		}()

		ready := waitForPort(port, s.cfg.StartupTimeout) && waitForHealth(port, s.cfg.HealthPath, s.cfg.HealthRetries, s.cfg.StartupTimeout)
		restarting := false
		var exitErr error
		if !ready {
			exitErr = terminateAndWait(cmd, waitCh, s.cfg.StopTimeout)
			if exitErr == nil {
				exitErr = errors.New("plugin failed health check")
			}
			s.stateMu.set(0, false, exitErr)
		} else {
			s.stateMu.set(port, true, nil)
			select {
			case <-ctx.Done():
				_ = terminateAndWait(cmd, waitCh, s.cfg.StopTimeout)
				s.cfg.Allocator.Release(s.cfg.Name)
				s.stateMu.set(0, false, ctx.Err())
				return
			case <-s.restartCh:
				restarting = true
				_ = terminateAndWait(cmd, waitCh, s.cfg.StopTimeout)
			case err := <-waitCh:
				exitErr = err
				if err != nil {
					s.stateMu.set(port, false, err)
				}
			}
		}

		s.cfg.Allocator.Release(s.cfg.Name)
		s.stateMu.set(0, false, exitErr)

		if restarting {
			failures = 0
			continue
		}

		failures++
		if failures >= s.cfg.MaxFailures {
			s.stateMu.set(0, false, errors.New("plugin crashed too many times"))
			return
		}

		backoff := s.cfg.BackoffBase << (failures - 1)
		if backoff > s.cfg.BackoffCap {
			backoff = s.cfg.BackoffCap
		}

		select {
		case <-ctx.Done():
			s.stateMu.set(0, false, ctx.Err())
			return
		case <-time.After(backoff):
		}
	}
}

func waitForPort(port int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 100*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return true
		}
		time.Sleep(25 * time.Millisecond)
	}
	return false
}

func waitForHealth(port int, path string, retries int, timeout time.Duration) bool {
	if retries < 0 {
		return true
	}
	if path == "" {
		path = "/health"
	}
	if retries <= 0 {
		retries = 3
	}

	client := &http.Client{Timeout: 250 * time.Millisecond}
	deadline := time.Now().Add(timeout)
	healthURL := fmt.Sprintf("http://127.0.0.1:%d%s", port, path)

	for attempt := 0; attempt < retries && time.Now().Before(deadline); attempt++ {
		resp, err := client.Get(healthURL)
		if err == nil {
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return true
			}
		}
		time.Sleep(100 * time.Millisecond)
	}

	return false
}

func terminateAndWait(cmd *exec.Cmd, waitCh <-chan error, timeout time.Duration) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}

	pgid, err := syscall.Getpgid(cmd.Process.Pid)
	if err == nil {
		_ = syscall.Kill(-pgid, syscall.SIGTERM)
	} else {
		_ = cmd.Process.Signal(syscall.SIGTERM)
	}

	select {
	case err := <-waitCh:
		return err
	case <-time.After(timeout):
		if err == nil {
			_ = syscall.Kill(-pgid, syscall.SIGKILL)
		} else {
			_ = cmd.Process.Kill()
		}
		return <-waitCh
	}
}

func (s *syncState) set(port int, running bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.currentPort = port
	s.running = running
	s.lastErr = err
}
