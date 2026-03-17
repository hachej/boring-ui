package ws

import (
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

type Connection interface {
	WriteMessage(messageType int, data []byte) error
	Close() error
}

type Message struct {
	Type int
	Data []byte
}

type Registry struct {
	mu       sync.RWMutex
	sessions map[string]map[Connection]struct{}
	limit    *Semaphore
}

func NewRegistry(maxConnections int) *Registry {
	return &Registry{
		sessions: make(map[string]map[Connection]struct{}),
		limit:    NewSemaphore(maxConnections),
	}
}

func (r *Registry) Register(sessionID string, conn Connection) error {
	if r == nil {
		return errors.New("registry is nil")
	}
	normalized := strings.TrimSpace(sessionID)
	if normalized == "" {
		return errors.New("sessionID is required")
	}
	if conn == nil {
		return errors.New("connection is required")
	}
	if err := r.limit.Acquire(); err != nil {
		return err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	peers := r.sessions[normalized]
	if peers == nil {
		peers = make(map[Connection]struct{})
		r.sessions[normalized] = peers
	}
	if _, exists := peers[conn]; exists {
		r.limit.Release()
		return nil
	}
	peers[conn] = struct{}{}
	return nil
}

func (r *Registry) Deregister(sessionID string, conn Connection) {
	if r == nil || conn == nil {
		return
	}
	normalized := strings.TrimSpace(sessionID)
	if normalized == "" {
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	peers := r.sessions[normalized]
	if peers == nil {
		return
	}
	if _, exists := peers[conn]; !exists {
		return
	}
	delete(peers, conn)
	r.limit.Release()
	if len(peers) == 0 {
		delete(r.sessions, normalized)
	}
}

func (r *Registry) Broadcast(sessionID string, message Message) error {
	if r == nil {
		return errors.New("registry is nil")
	}
	normalized := strings.TrimSpace(sessionID)
	if normalized == "" {
		return errors.New("sessionID is required")
	}

	r.mu.RLock()
	peers := r.sessions[normalized]
	if len(peers) == 0 {
		r.mu.RUnlock()
		return nil
	}
	connections := make([]Connection, 0, len(peers))
	for conn := range peers {
		connections = append(connections, conn)
	}
	r.mu.RUnlock()

	var wg sync.WaitGroup
	errs := make(chan error, len(connections))
	for _, conn := range connections {
		wg.Add(1)
		go func(conn Connection) {
			defer wg.Done()
			if err := conn.WriteMessage(message.Type, message.Data); err != nil {
				r.Deregister(normalized, conn)
				_ = conn.Close()
				errs <- fmt.Errorf("broadcast to peer failed: %w", err)
			}
		}(conn)
	}
	wg.Wait()
	close(errs)

	collected := make([]error, 0, len(connections))
	for err := range errs {
		collected = append(collected, err)
	}
	return errors.Join(collected...)
}

func (r *Registry) Connections(sessionID string) int {
	if r == nil {
		return 0
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.sessions[strings.TrimSpace(sessionID)])
}

func (r *Registry) SessionCount() int {
	if r == nil {
		return 0
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.sessions)
}

func (r *Registry) InUse() int {
	if r == nil {
		return 0
	}
	return r.limit.InUse()
}

func TextMessage(payload []byte) Message {
	return Message{Type: websocket.TextMessage, Data: payload}
}
