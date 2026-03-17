package ws

import (
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const (
	defaultPingInterval   = 15 * time.Second
	defaultPongWait       = 15 * time.Second
	defaultWriteWait      = 5 * time.Second
	defaultMaxMissedPongs = 3
)

type ConnOption func(*Conn)

type Conn struct {
	raw            *websocket.Conn
	pingInterval   time.Duration
	pongWait       time.Duration
	writeWait      time.Duration
	maxMissedPongs int32

	done      chan struct{}
	closeOnce sync.Once
	writeMu   sync.Mutex
	missed    atomic.Int32
}

func NewConn(raw *websocket.Conn, options ...ConnOption) *Conn {
	conn := &Conn{
		raw:            raw,
		pingInterval:   defaultPingInterval,
		pongWait:       defaultPongWait,
		writeWait:      defaultWriteWait,
		maxMissedPongs: defaultMaxMissedPongs,
		done:           make(chan struct{}),
	}
	for _, option := range options {
		if option != nil {
			option(conn)
		}
	}

	if conn.raw != nil {
		_ = conn.raw.SetReadDeadline(time.Now().Add(conn.readDeadline()))
		conn.raw.SetPongHandler(func(string) error {
			conn.missed.Store(0)
			return conn.raw.SetReadDeadline(time.Now().Add(conn.readDeadline()))
		})
		go conn.runHeartbeat()
	}

	return conn
}

func WithPingInterval(interval time.Duration) ConnOption {
	return func(conn *Conn) {
		if interval > 0 {
			conn.pingInterval = interval
		}
	}
}

func WithPongWait(wait time.Duration) ConnOption {
	return func(conn *Conn) {
		if wait > 0 {
			conn.pongWait = wait
		}
	}
}

func WithWriteWait(wait time.Duration) ConnOption {
	return func(conn *Conn) {
		if wait > 0 {
			conn.writeWait = wait
		}
	}
}

func WithMaxMissedPongs(max int) ConnOption {
	return func(conn *Conn) {
		if max > 0 {
			conn.maxMissedPongs = int32(max)
		}
	}
}

func (c *Conn) Raw() *websocket.Conn {
	if c == nil {
		return nil
	}
	return c.raw
}

func (c *Conn) Done() <-chan struct{} {
	if c == nil {
		ch := make(chan struct{})
		close(ch)
		return ch
	}
	return c.done
}

func (c *Conn) ReadMessage() (int, []byte, error) {
	if c == nil || c.raw == nil {
		return 0, nil, net.ErrClosed
	}
	return c.raw.ReadMessage()
}

func (c *Conn) WriteMessage(messageType int, data []byte) error {
	if c == nil || c.raw == nil {
		return net.ErrClosed
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if err := c.raw.SetWriteDeadline(time.Now().Add(c.writeWait)); err != nil {
		return err
	}
	return c.raw.WriteMessage(messageType, data)
}

func (c *Conn) Close() error {
	if c == nil || c.raw == nil {
		return nil
	}

	var err error
	c.closeOnce.Do(func() {
		close(c.done)
		err = c.raw.Close()
	})
	return err
}

func (c *Conn) runHeartbeat() {
	ticker := time.NewTicker(c.pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
			if c.missed.Add(1) > c.maxMissedPongs {
				_ = c.Close()
				return
			}
			if err := c.writeControl(websocket.PingMessage, []byte("ping")); err != nil {
				_ = c.Close()
				return
			}
		}
	}
}

func (c *Conn) writeControl(messageType int, data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if err := c.raw.SetWriteDeadline(time.Now().Add(c.writeWait)); err != nil {
		return err
	}
	return c.raw.WriteControl(messageType, data, time.Now().Add(c.writeWait))
}

func (c *Conn) readDeadline() time.Duration {
	return time.Duration(c.maxMissedPongs+1) * c.pongWait
}
