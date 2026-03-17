package ws

import (
	"errors"
	"net/http"
	"sync/atomic"
)

const DefaultMaxConnections = 100

var ErrAtCapacity = errors.New("at capacity")

type Semaphore struct {
	max   int64
	inUse atomic.Int64
}

func NewSemaphore(max int) *Semaphore {
	if max <= 0 {
		max = DefaultMaxConnections
	}
	return &Semaphore{max: int64(max)}
}

func (s *Semaphore) Acquire() error {
	if s == nil {
		return nil
	}
	for {
		current := s.inUse.Load()
		if current >= s.max {
			return ErrAtCapacity
		}
		if s.inUse.CompareAndSwap(current, current+1) {
			return nil
		}
	}
}

func (s *Semaphore) Release() {
	if s == nil {
		return
	}
	for {
		current := s.inUse.Load()
		if current == 0 {
			return
		}
		if s.inUse.CompareAndSwap(current, current-1) {
			return
		}
	}
}

func (s *Semaphore) InUse() int {
	if s == nil {
		return 0
	}
	return int(s.inUse.Load())
}

func (s *Semaphore) Max() int {
	if s == nil {
		return 0
	}
	return int(s.max)
}

func WriteCapacityError(w http.ResponseWriter) {
	http.Error(w, ErrAtCapacity.Error(), http.StatusServiceUnavailable)
}
