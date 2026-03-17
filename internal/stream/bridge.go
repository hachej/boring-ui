package stream

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"syscall"
	"time"
)

const (
	defaultKillDelay     = 5 * time.Second
	defaultScannerBuffer = 1024 * 1024
)

type Broadcaster interface {
	Broadcast(payload []byte) error
}

type CommandFactory interface {
	CommandContext(ctx context.Context, name string, args ...string) *exec.Cmd
}

type Config struct {
	Command string
	Args    []string
	Dir     string
	Env     []string
}

type Option func(*Bridge)

type Bridge struct {
	session         Broadcaster
	factory         CommandFactory
	killDelay       time.Duration
	maxScannerToken int
	mu              sync.Mutex
	stdin           io.WriteCloser
	wg              sync.WaitGroup
	errMu           sync.Mutex
	errs            []error
}

type execCommandFactory struct{}

func (execCommandFactory) CommandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, name, args...)
}

func NewBridge(session Broadcaster, options ...Option) *Bridge {
	bridge := &Bridge{
		session:         session,
		factory:         execCommandFactory{},
		killDelay:       defaultKillDelay,
		maxScannerToken: defaultScannerBuffer,
	}
	for _, option := range options {
		if option != nil {
			option(bridge)
		}
	}
	return bridge
}

func WithCommandFactory(factory CommandFactory) Option {
	return func(bridge *Bridge) {
		if factory != nil {
			bridge.factory = factory
		}
	}
}

func WithKillDelay(delay time.Duration) Option {
	return func(bridge *Bridge) {
		if delay > 0 {
			bridge.killDelay = delay
		}
	}
}

func WithScannerTokenLimit(limit int) Option {
	return func(bridge *Bridge) {
		if limit > 0 {
			bridge.maxScannerToken = limit
		}
	}
}

func (b *Bridge) Start(ctx context.Context, cfg Config) error {
	if b == nil {
		return errors.New("bridge is nil")
	}
	if b.session == nil {
		return errors.New("session broadcaster is required")
	}
	if b.factory == nil {
		return errors.New("command factory is required")
	}
	if cfg.Command == "" {
		return errors.New("command is required")
	}

	cmd := b.factory.CommandContext(ctx, cfg.Command, cfg.Args...)
	cmd.Dir = cfg.Dir
	cmd.Env = append(os.Environ(), cfg.Env...)
	if cmd.Cancel != nil {
		cmd.Cancel = b.cancelFunc(cmd)
	}
	cmd.WaitDelay = b.killDelay

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = io.Discard

	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		return err
	}

	b.mu.Lock()
	b.stdin = stdin
	b.mu.Unlock()

	b.wg.Add(2)
	go b.readLoop(ctx, stdout)
	go b.waitLoop(ctx, cmd)

	return nil
}

func (b *Bridge) ForwardFrontend(payload []byte) error {
	if b == nil {
		return errors.New("bridge is nil")
	}

	trimmed := bytes.TrimSpace(payload)
	if len(trimmed) == 0 {
		return errors.New("payload is required")
	}
	var envelope map[string]any
	if err := json.Unmarshal(trimmed, &envelope); err != nil {
		return err
	}

	b.mu.Lock()
	defer b.mu.Unlock()
	if b.stdin == nil {
		return errors.New("bridge stdin is not available")
	}
	if _, err := b.stdin.Write(append(append([]byte(nil), trimmed...), '\n')); err != nil {
		return err
	}
	return nil
}

func (b *Bridge) Wait() error {
	if b == nil {
		return nil
	}
	b.wg.Wait()
	b.errMu.Lock()
	defer b.errMu.Unlock()
	return errors.Join(b.errs...)
}

func (b *Bridge) readLoop(ctx context.Context, stdout io.ReadCloser) {
	defer b.wg.Done()
	defer stdout.Close()

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), b.maxScannerToken)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal(line, &payload); err != nil {
			b.recordErr(err)
			continue
		}
		if err := b.session.Broadcast(append([]byte(nil), line...)); err != nil {
			b.recordErr(err)
		}
	}
	if err := scanner.Err(); err != nil && ctx.Err() == nil {
		b.recordErr(err)
	}
}

func (b *Bridge) waitLoop(ctx context.Context, cmd *exec.Cmd) {
	defer b.wg.Done()

	err := cmd.Wait()

	b.mu.Lock()
	if b.stdin != nil {
		_ = b.stdin.Close()
		b.stdin = nil
	}
	b.mu.Unlock()

	if err != nil && ctx.Err() == nil {
		b.recordErr(err)
	}
}

func (b *Bridge) recordErr(err error) {
	if err == nil {
		return
	}
	b.errMu.Lock()
	defer b.errMu.Unlock()
	b.errs = append(b.errs, err)
}

func (b *Bridge) cancelFunc(cmd *exec.Cmd) func() error {
	return func() error {
		if cmd == nil || cmd.Process == nil {
			return nil
		}
		if runtime.GOOS == "windows" {
			return cmd.Process.Kill()
		}
		return cmd.Process.Signal(syscall.SIGTERM)
	}
}
