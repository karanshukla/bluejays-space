package main

import (
	"encoding/json"
	"fmt"
	"os"
)

// ErrHandleTaken is returned by add when a handle already exists with a different DID.
type ErrHandleTaken struct {
	Handle      string
	ExistingDID string
}

func (e ErrHandleTaken) Error() string {
	return fmt.Sprintf("handle %q is already registered to %s", e.Handle, e.ExistingDID)
}

// loadHandles reads and parses a JSON file into a handle→DID map.
func loadHandles(path string) (map[string]string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var m map[string]string
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return m, nil
}

// saveHandles writes a handle→DID map back to disk as pretty-printed JSON.
func saveHandles(m map[string]string, path string) error {
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(b, '\n'), 0644)
}

// add upserts handle→did into m, enforcing:
//   - a handle is locked to its original DID (same handle + different DID → ErrHandleTaken)
//   - a DID belongs to one handle (an existing entry under a different handle is removed)
//
// Returns the old handle displaced by a DID move, or "" if none.
func add(m map[string]string, handle, did string) (displaced string, err error) {
	if existing, ok := m[handle]; ok && existing != did {
		return "", ErrHandleTaken{Handle: handle, ExistingDID: existing}
	}
	for h, d := range m {
		if d == did && h != handle {
			delete(m, h)
			displaced = h
		}
	}
	m[handle] = did
	return displaced, nil
}

// warnDuplicateDIDs logs a warning for every DID registered under more than one
// handle. Returns the number of duplicates found.
func warnDuplicateDIDs(m map[string]string, warn func(string, ...any)) int {
	seen := make(map[string]string, len(m))
	count := 0
	for handle, did := range m {
		if existing, ok := seen[did]; ok {
			warn("WARNING: DID %q registered to both %q and %q", did, existing, handle)
			count++
		}
		seen[did] = handle
	}
	return count
}
