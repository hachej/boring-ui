package plugins

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"sync"
	"time"
)

const discoveryWatchName = "__plugins_discovery__"

type Manager struct {
	mu          sync.RWMutex
	root        string
	pluginDirs  []string
	specs       map[string]Spec
	supervisors map[string]*Supervisor
	allocator   *PortAllocator
	watcher     *Watcher
	signer      *RequestSigner
	runCtx      context.Context
	subscribers map[chan LifecycleEvent]struct{}
}

func NewManager(root string, pluginDirs ...string) (*Manager, error) {
	specs, err := Discover(root, pluginDirs...)
	if err != nil {
		return nil, err
	}

	manager := &Manager{
		root:        root,
		pluginDirs:  append([]string(nil), pluginDirs...),
		specs:       map[string]Spec{},
		supervisors: map[string]*Supervisor{},
		allocator:   NewPortAllocator(),
		signer:      NewRequestSigner(""),
		subscribers: map[chan LifecycleEvent]struct{}{},
	}

	for _, spec := range specs {
		manager.specs[spec.Name] = spec
		manager.supervisors[spec.Name] = manager.newSupervisor(spec)
	}

	return manager, nil
}

func (m *Manager) Start(ctx context.Context) error {
	m.mu.Lock()
	m.runCtx = ctx
	supervisors := make([]*Supervisor, 0, len(m.supervisors))
	for _, supervisor := range m.supervisors {
		supervisors = append(supervisors, supervisor)
	}
	specs := make(map[string]Spec, len(m.specs))
	for name, spec := range m.specs {
		specs[name] = spec
	}
	roots := m.discoveryRoots()
	m.mu.Unlock()

	started := make([]*Supervisor, 0, len(supervisors))
	for _, supervisor := range supervisors {
		if err := supervisor.Start(ctx); err != nil {
			m.stopStarted(ctx, started)
			return err
		}
		started = append(started, supervisor)
	}

	watcher, err := NewWatcher(200*time.Millisecond, func(name string) {
		if name == discoveryWatchName {
			_ = m.Sync()
			return
		}
		_ = m.restartAndBroadcast(name)
	})
	if err != nil {
		m.stopStarted(ctx, started)
		return err
	}

	for _, root := range roots {
		if err := watcher.Add(discoveryWatchName, []string{root}); err != nil {
			_ = watcher.Close()
			m.stopStarted(ctx, started)
			return err
		}
	}
	for name, spec := range specs {
		if err := watcher.Add(name, spec.Watch); err != nil {
			_ = watcher.Close()
			m.stopStarted(ctx, started)
			return err
		}
	}

	m.mu.Lock()
	m.watcher = watcher
	m.mu.Unlock()

	go func() {
		_ = watcher.Run(ctx)
	}()
	return nil
}

func (m *Manager) Stop(ctx context.Context) error {
	var stopErr error

	m.mu.Lock()
	watcher := m.watcher
	m.watcher = nil
	supervisors := make([]*Supervisor, 0, len(m.supervisors))
	for _, supervisor := range m.supervisors {
		supervisors = append(supervisors, supervisor)
	}
	m.mu.Unlock()

	if watcher != nil {
		if err := watcher.Close(); err != nil && stopErr == nil {
			stopErr = err
		}
	}
	for _, supervisor := range supervisors {
		if err := supervisor.Stop(ctx); err != nil && stopErr == nil {
			stopErr = err
		}
	}
	return stopErr
}

func (m *Manager) Port(name string) (int, bool) {
	m.mu.RLock()
	supervisor, ok := m.supervisors[name]
	m.mu.RUnlock()
	if !ok {
		return 0, false
	}
	port := supervisor.CurrentPort()
	return port, port != 0
}

func (m *Manager) Restart(name string) error {
	m.mu.RLock()
	supervisor, ok := m.supervisors[name]
	m.mu.RUnlock()
	if !ok {
		return errors.New("plugin not found")
	}
	supervisor.Restart()
	m.broadcast(NewLifecycleEvent(LifecycleEventRestart, name))
	return nil
}

func (m *Manager) Signer() *RequestSigner {
	if m == nil {
		return nil
	}
	return m.signer
}

func (m *Manager) Subscribe(buffer int) (<-chan LifecycleEvent, func()) {
	if buffer <= 0 {
		buffer = 8
	}
	ch := make(chan LifecycleEvent, buffer)
	m.mu.Lock()
	m.subscribers[ch] = struct{}{}
	m.mu.Unlock()
	return ch, func() {
		m.mu.Lock()
		if _, ok := m.subscribers[ch]; ok {
			delete(m.subscribers, ch)
			close(ch)
		}
		m.mu.Unlock()
	}
}

func (m *Manager) Sync() error {
	specs, err := Discover(m.root, m.pluginDirs...)
	if err != nil {
		return err
	}

	type addOp struct {
		name       string
		spec       Spec
		supervisor *Supervisor
	}
	type replaceOp struct {
		name       string
		spec       Spec
		old        *Supervisor
		supervisor *Supervisor
	}

	discovered := make(map[string]Spec, len(specs))
	for _, spec := range specs {
		discovered[spec.Name] = spec
	}

	m.mu.Lock()
	runCtx := m.runCtx
	watcher := m.watcher

	removed := make(map[string]*Supervisor)
	for name, supervisor := range m.supervisors {
		if _, ok := discovered[name]; !ok {
			removed[name] = supervisor
			delete(m.supervisors, name)
			delete(m.specs, name)
		}
	}

	added := make([]addOp, 0)
	replaced := make([]replaceOp, 0)
	for name, spec := range discovered {
		existingSpec, ok := m.specs[name]
		if !ok {
			supervisor := m.newSupervisor(spec)
			m.specs[name] = spec
			m.supervisors[name] = supervisor
			added = append(added, addOp{name: name, spec: spec, supervisor: supervisor})
			continue
		}
		if reflect.DeepEqual(existingSpec, spec) {
			continue
		}
		supervisor := m.newSupervisor(spec)
		replaced = append(replaced, replaceOp{
			name:       name,
			spec:       spec,
			old:        m.supervisors[name],
			supervisor: supervisor,
		})
		m.specs[name] = spec
		m.supervisors[name] = supervisor
	}
	m.mu.Unlock()

	for name, supervisor := range removed {
		stopCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = supervisor.Stop(stopCtx)
		cancel()
		m.broadcast(NewLifecycleEvent(LifecycleEventRemove, name))
	}
	for _, replacement := range replaced {
		stopCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = replacement.old.Stop(stopCtx)
		cancel()
		if runCtx != nil {
			if err := replacement.supervisor.Start(runCtx); err != nil {
				return err
			}
		}
		if watcher != nil {
			if err := watcher.Add(replacement.name, replacement.spec.Watch); err != nil {
				return err
			}
		}
		m.broadcast(NewLifecycleEvent(LifecycleEventRestart, replacement.name))
	}
	for _, addition := range added {
		if runCtx != nil {
			if err := addition.supervisor.Start(runCtx); err != nil {
				return err
			}
		}
		if watcher != nil {
			if err := watcher.Add(addition.name, addition.spec.Watch); err != nil {
				return err
			}
		}
		m.broadcast(NewLifecycleEvent(LifecycleEventAdd, addition.name))
	}
	return nil
}

func (m *Manager) stopStarted(ctx context.Context, supervisors []*Supervisor) {
	stopCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for _, supervisor := range supervisors {
		_ = supervisor.Stop(stopCtx)
	}
}

func (m *Manager) newSupervisor(spec Spec) *Supervisor {
	env := make(map[string]string, len(spec.Env)+2)
	for key, value := range spec.Env {
		env[key] = value
	}
	env[EnvAuthSecret] = m.signer.SharedSecret()
	env[EnvPluginName] = spec.Name

	return NewSupervisor(SupervisorConfig{
		Name:      spec.Name,
		Command:   spec.Command,
		Dir:       spec.Dir,
		Env:       env,
		Allocator: m.allocator,
	})
}

func (m *Manager) restartAndBroadcast(name string) error {
	m.mu.RLock()
	supervisor, ok := m.supervisors[name]
	m.mu.RUnlock()
	if !ok {
		return nil
	}
	supervisor.Restart()
	m.broadcast(NewLifecycleEvent(LifecycleEventRestart, name))
	return nil
}

func (m *Manager) broadcast(event LifecycleEvent) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for subscriber := range m.subscribers {
		select {
		case subscriber <- event:
		default:
		}
	}
}

func (m *Manager) discoveryRoots() []string {
	if len(m.pluginDirs) > 0 {
		roots := make([]string, 0, len(m.pluginDirs))
		roots = append(roots, m.pluginDirs...)
		return roots
	}
	return []string{filepath.Join(m.root, "kurt", "plugins")}
}
