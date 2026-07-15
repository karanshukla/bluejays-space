//go:build ignore

// Usage: go run add-handle.go <handle> <did>
package main

import (
	"fmt"
	"log"
	"os"
	"strings"
)

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
