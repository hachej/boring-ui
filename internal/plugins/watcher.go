package plugins

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type Watcher struct {
	watcher    *fsnotify.Watcher
	onChange   func(string)
	debounce   time.Duration
	mu         sync.Mutex
	closed     bool
	targets    map[string][]string
	watchedDir map[string]struct{}
	timers     map[string]*time.Timer
}

func NewWatcher(debounce time.Duration, onChange func(string)) (*Watcher, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if debounce <= 0 {
		debounce = 200 * time.Millisecond
	}
	return &Watcher{
		watcher:    watcher,
		onChange:   onChange,
		debounce:   debounce,
		targets:    map[string][]string{},
		watchedDir: map[string]struct{}{},
		timers:     map[string]*time.Timer{},
	}, nil
}

func (w *Watcher) Add(name string, paths []string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return nil
	}

	cleaned := make([]string, 0, len(paths))
	for _, path := range paths {
		if strings.TrimSpace(path) == "" {
			continue
		}
		cleaned = append(cleaned, filepath.Clean(path))
	}
	if len(cleaned) == 0 {
		return nil
	}
	w.targets[name] = cleaned

	for _, target := range cleaned {
		if err := w.addTargetLocked(target); err != nil {
			return err
		}
	}
	return nil
}

func (w *Watcher) Run(ctx context.Context) error {
	defer w.Close()

	for {
		select {
		case <-ctx.Done():
			return nil
		case event, ok := <-w.watcher.Events:
			if !ok {
				return nil
			}
			w.handleEvent(event)
		case _, ok := <-w.watcher.Errors:
			if !ok {
				return nil
			}
		}
	}
}

func (w *Watcher) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return nil
	}
	w.closed = true
	for _, timer := range w.timers {
		timer.Stop()
	}
	return w.watcher.Close()
}

func (w *Watcher) handleEvent(event fsnotify.Event) {
	w.mu.Lock()
	defer w.mu.Unlock()

	cleanName := filepath.Clean(event.Name)
	if event.Has(fsnotify.Create) {
		if info, err := os.Stat(cleanName); err == nil && info.IsDir() {
			_ = w.addDirLocked(cleanName)
		}
	}

	for plugin, targets := range w.targets {
		if !matchesAnyTarget(cleanName, targets) {
			continue
		}

		if timer, ok := w.timers[plugin]; ok {
			timer.Reset(w.debounce)
			continue
		}

		pluginName := plugin
		w.timers[plugin] = time.AfterFunc(w.debounce, func() {
			w.onChange(pluginName)
			w.mu.Lock()
			delete(w.timers, pluginName)
			w.mu.Unlock()
		})
	}
}

func (w *Watcher) addTargetLocked(target string) error {
	info, err := os.Stat(target)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if !info.IsDir() {
		return w.addDirLocked(filepath.Dir(target))
	}
	return filepath.WalkDir(target, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !entry.IsDir() {
			return nil
		}
		return w.addDirLocked(path)
	})
}

func (w *Watcher) addDirLocked(dir string) error {
	dir = filepath.Clean(dir)
	if _, ok := w.watchedDir[dir]; ok {
		return nil
	}
	if err := w.watcher.Add(dir); err != nil {
		return err
	}
	w.watchedDir[dir] = struct{}{}
	return nil
}

func matchesAnyTarget(name string, targets []string) bool {
	for _, target := range targets {
		if name == target {
			return true
		}
		if strings.HasPrefix(name, target+string(os.PathSeparator)) {
			return true
		}
	}
	return false
}
