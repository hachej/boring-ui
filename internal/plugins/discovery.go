package plugins

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/BurntSushi/toml"
)

type Spec struct {
	Name         string            `toml:"name"`
	Command      []string          `toml:"command"`
	Dir          string            `toml:"dir"`
	Watch        []string          `toml:"watch"`
	Env          map[string]string `toml:"env"`
	ManifestPath string            `toml:"-"`
}

func Discover(root string, pluginDirs ...string) ([]Spec, error) {
	searchRoots := pluginDirs
	if len(searchRoots) == 0 {
		searchRoots = []string{filepath.Join(root, "kurt", "plugins")}
	}

	var specs []Spec
	for _, searchRoot := range searchRoots {
		entries, err := os.ReadDir(searchRoot)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}

		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}

			manifestPath := filepath.Join(searchRoot, entry.Name(), "plugin.toml")
			if _, err := os.Stat(manifestPath); err != nil {
				if os.IsNotExist(err) {
					continue
				}
				return nil, err
			}

			var spec Spec
			if _, err := toml.DecodeFile(manifestPath, &spec); err != nil {
				continue
			}

			spec.ManifestPath = manifestPath
			if strings.TrimSpace(spec.Name) == "" {
				spec.Name = entry.Name()
			}
			if len(spec.Command) == 0 {
				continue
			}

			pluginDir := filepath.Dir(manifestPath)
			if strings.TrimSpace(spec.Dir) == "" {
				spec.Dir = pluginDir
			} else if !filepath.IsAbs(spec.Dir) {
				spec.Dir = filepath.Join(pluginDir, spec.Dir)
			}
			spec.Dir = filepath.Clean(spec.Dir)

			if len(spec.Watch) == 0 {
				spec.Watch = []string{"."}
			}
			for i, watch := range spec.Watch {
				if filepath.IsAbs(watch) {
					spec.Watch[i] = filepath.Clean(watch)
					continue
				}
				spec.Watch[i] = filepath.Clean(filepath.Join(pluginDir, watch))
			}

			specs = append(specs, spec)
		}
	}

	sort.Slice(specs, func(i, j int) bool {
		return specs[i].Name < specs[j].Name
	})
	return specs, nil
}
