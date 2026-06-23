//go:build ignore

package main

import (
	"fmt"
	"log"
	"os"
	"strings"
)

// Usage: go run add-handle.go <handle> <did>
//
// Rules:
//   - Same handle + different DID → rejected (handle is locked to its owner)
//   - New handle + existing DID   → old handle removed, new pair added (rename)
//   - Same handle + same DID      → no-op
//   - New handle + new DID        → added normally
func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: go run add-handle.go <handle> <did>")
		os.Exit(1)
	}

	handle := strings.ToLower(strings.TrimSpace(os.Args[1]))
	did := strings.TrimSpace(os.Args[2])

	const file = "handles.json"
	m, err := loadHandles(file)
	if err != nil {
		log.Fatalf("could not load %s: %v", file, err)
	}

	displaced, err := add(m, handle, did)
	if err != nil {
		log.Fatalf("%v", err)
	}
	if displaced != "" {
		fmt.Printf("removed old handle: %s\n", displaced)
	}

	if err := saveHandles(m, file); err != nil {
		log.Fatalf("could not save %s: %v", file, err)
	}
	fmt.Printf("set %s -> %s\n", handle, did)
}
