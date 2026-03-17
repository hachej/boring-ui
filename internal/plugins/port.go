package plugins

import (
	"errors"
	"fmt"
	"net"
	"sync"
)

const (
	defaultMinPort = 19000
	defaultMaxPort = 19999
)

var ErrNoPortsAvailable = errors.New("no plugin ports available")

type PortAllocator struct {
	mu       sync.Mutex
	minPort  int
	maxPort  int
	nextPort int
	inUse    map[string]int
	usedPort map[int]string
	released []int
}

func NewPortAllocator() *PortAllocator {
	return &PortAllocator{
		minPort:  defaultMinPort,
		maxPort:  defaultMaxPort,
		nextPort: defaultMinPort,
		inUse:    map[string]int{},
		usedPort: map[int]string{},
	}
}

func (a *PortAllocator) Acquire(name string) (int, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if port, ok := a.inUse[name]; ok {
		return port, nil
	}

	for len(a.released) > 0 {
		port := a.released[len(a.released)-1]
		a.released = a.released[:len(a.released)-1]
		if _, busy := a.usedPort[port]; busy {
			continue
		}
		if !isTCPPortFree(port) {
			continue
		}
		a.assignLocked(name, port)
		return port, nil
	}

	for offset := 0; offset <= a.maxPort-a.minPort; offset++ {
		port := a.minPort + ((a.nextPort - a.minPort + offset) % (a.maxPort - a.minPort + 1))
		if _, busy := a.usedPort[port]; busy {
			continue
		}
		if !isTCPPortFree(port) {
			continue
		}
		a.assignLocked(name, port)
		a.nextPort = port + 1
		if a.nextPort > a.maxPort {
			a.nextPort = a.minPort
		}
		return port, nil
	}

	return 0, ErrNoPortsAvailable
}

func (a *PortAllocator) Release(name string) {
	a.mu.Lock()
	defer a.mu.Unlock()

	port, ok := a.inUse[name]
	if !ok {
		return
	}
	delete(a.inUse, name)
	delete(a.usedPort, port)
	a.released = append(a.released, port)
}

func (a *PortAllocator) assignLocked(name string, port int) {
	a.inUse[name] = port
	a.usedPort[port] = name
}

func isTCPPortFree(port int) bool {
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = listener.Close()
	return true
}
