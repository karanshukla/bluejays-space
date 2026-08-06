package main

import (
	"errors"
	"testing"
)

// --- add() ---

func TestAdd_NewHandleNewDID(t *testing.T) {
	m := map[string]string{}
	displaced, err := add(m, "alice", "did:plc:abc")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if displaced != "" {
		t.Errorf("expected no displaced handle, got %q", displaced)
	}
	if m["alice"] != "did:plc:abc" {
		t.Errorf("expected alice=did:plc:abc, got %q", m["alice"])
	}
}

func TestAdd_SameHandleSameDID_Noop(t *testing.T) {
	m := map[string]string{"alice": "did:plc:abc"}
	displaced, err := add(m, "alice", "did:plc:abc")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if displaced != "" {
		t.Errorf("expected no displaced handle, got %q", displaced)
	}
	if len(m) != 1 || m["alice"] != "did:plc:abc" {
		t.Errorf("map modified unexpectedly: %v", m)
	}
}

func TestAdd_SameHandleDifferentDID_Rejected(t *testing.T) {
	m := map[string]string{"alice": "did:plc:abc"}
	_, err := add(m, "alice", "did:plc:xyz")
	if err == nil {
		t.Fatal("expected ErrHandleTaken, got nil")
	}
	var taken ErrHandleTaken
	if !errors.As(err, &taken) {
		t.Fatalf("expected ErrHandleTaken, got %T: %v", err, err)
	}
	if taken.Handle != "alice" || taken.ExistingDID != "did:plc:abc" {
		t.Errorf("unexpected ErrHandleTaken fields: %+v", taken)
	}
	if m["alice"] != "did:plc:abc" {
		t.Errorf("map was mutated on error: %v", m)
	}
}

func TestAdd_NewHandleExistingDID_DisplacesOld(t *testing.T) {
	m := map[string]string{
		"alice": "did:plc:abc",
		"bob":   "did:plc:bob",
	}
	displaced, err := add(m, "alice2", "did:plc:abc")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if displaced != "alice" {
		t.Errorf("expected displaced=alice, got %q", displaced)
	}
	if _, ok := m["alice"]; ok {
		t.Error("old handle 'alice' should have been removed")
	}
	if m["alice2"] != "did:plc:abc" {
		t.Errorf("expected alice2=did:plc:abc, got %q", m["alice2"])
	}
	if m["bob"] != "did:plc:bob" {
		t.Errorf("unrelated entry 'bob' was modified: %v", m)
	}
}

// --- warnDuplicateDIDs() ---

func TestWarnDuplicateDIDs_Clean(t *testing.T) {
	m := map[string]string{"alice": "did:plc:a", "bob": "did:plc:b"}
	count := warnDuplicateDIDs(m, func(string, ...any) {})
	if count != 0 {
		t.Errorf("expected 0 duplicates, got %d", count)
	}
}

func TestWarnDuplicateDIDs_Duplicate(t *testing.T) {
	m := map[string]string{"alice": "did:plc:same", "bob": "did:plc:same"}
	var warnings []string
	count := warnDuplicateDIDs(m, func(f string, _ ...any) {
		warnings = append(warnings, f)
	})
	if count != 1 {
		t.Errorf("expected 1 duplicate, got %d", count)
	}
	if len(warnings) != 1 {
		t.Errorf("expected 1 warning, got %d", len(warnings))
	}
}

// --- isValidHandle() ---

func TestIsValidHandle(t *testing.T) {
	valid := []string{"alice", "bob123", "my-handle", "a", "ab"}
	for _, h := range valid {
		if !isValidHandle(h) {
			t.Errorf("expected %q to be valid", h)
		}
	}

	invalid := []string{"", "-alice", "alice-", "Alice", "ali ce", "this-handle-is-way-too-long-to-be-valid-here"}
	for _, h := range invalid {
		if isValidHandle(h) {
			t.Errorf("expected %q to be invalid", h)
		}
	}
}

// --- isValidDID() ---

func TestIsValidDID(t *testing.T) {
	valid := []string{"did:plc:abc123", "did:web:example.com"}
	for _, d := range valid {
		if !isValidDID(d) {
			t.Errorf("expected %q to be valid", d)
		}
	}

	invalid := []string{"", "notadid", "did:other:abc", "did:plc:has space"}
	for _, d := range invalid {
		if isValidDID(d) {
			t.Errorf("expected %q to be invalid", d)
		}
	}
}

// --- canonicalRedirect() ---

func TestCanonicalRedirect_CollapsesWildcardHostsOntoTheCanonicalOne(t *testing.T) {
	// Every one of these serves the identical form today. Left alone they are
	// duplicates of each other in Google's index, and the set grows with every
	// handle merged.
	for _, host := range []string{"alice.bluejays.space", "www.bluejays.space", "bo.bluejays.space"} {
		got := canonicalRedirect(host, "bluejays.space", "/")
		if want := "https://handles.bluejays.space/"; got != want {
			t.Errorf("host %q: got %q, want %q", host, got, want)
		}
	}
}

func TestCanonicalRedirect_LeavesTheCanonicalHostAlone(t *testing.T) {
	if got := canonicalRedirect("handles.bluejays.space", "bluejays.space", "/"); got != "" {
		t.Errorf("expected no redirect on the canonical host, got %q", got)
	}
}

func TestCanonicalRedirect_LeavesHostsOutsideTheWildcardAlone(t *testing.T) {
	// Dev, Railway's internal health check, and a direct IP must keep working —
	// redirecting them to a public hostname would break local runs and probes.
	for _, host := range []string{"localhost", "127.0.0.1", "bluejays-handles.railway.internal"} {
		if got := canonicalRedirect(host, "bluejays.space", "/"); got != "" {
			t.Errorf("host %q: expected no redirect, got %q", host, got)
		}
	}
}

func TestCanonicalRedirect_DoesNotMatchOnASuffixThatIsNotASubdomain(t *testing.T) {
	// "notbluejays.space" ends with "bluejays.space" as a string but is a
	// different registrable domain — redirecting it would be sending traffic
	// off a host we don't control.
	if got := canonicalRedirect("notbluejays.space", "bluejays.space", "/"); got != "" {
		t.Errorf("expected no redirect, got %q", got)
	}
}

func TestCanonicalRedirect_PreservesPathAndQuery(t *testing.T) {
	// The form posts to /request-handle and lands back on /?job=...&handle=...;
	// dropping the query would strand the visitor on a page with no status.
	got := canonicalRedirect("alice.bluejays.space", "bluejays.space", "/?job=abc123&handle=bo")
	if want := "https://handles.bluejays.space/?job=abc123&handle=bo"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestCanonicalRedirect_HonoursAConfiguredBaseDomain(t *testing.T) {
	got := canonicalRedirect("alice.staging.example", "staging.example", "/")
	if want := "https://handles.staging.example/"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
