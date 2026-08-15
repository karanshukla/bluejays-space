package main

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
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

// --- clientIP() / rate limiting ---

func TestClientIP_TrustsAWellFormedCFConnectingIP(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/request-handle", nil)
	r.Header.Set("CF-Connecting-IP", "203.0.113.5")
	r.RemoteAddr = "10.0.0.1:5000"
	if got := clientIP(r); got != "203.0.113.5" {
		t.Errorf("got %q, want %q", got, "203.0.113.5")
	}
}

func TestClientIP_IgnoresAHeaderThatIsNotAnAddress(t *testing.T) {
	for _, claimed := range []string{"bucket-1", "203.0.113.5, 10.0.0.1", "999.999.999.999", ""} {
		r := httptest.NewRequest(http.MethodPost, "/request-handle", nil)
		r.Header.Set("CF-Connecting-IP", claimed)
		r.RemoteAddr = "10.0.0.1:5000"
		if got := clientIP(r); got != "10.0.0.1" {
			t.Errorf("claimed %q: got %q, want the peer address", claimed, got)
		}
	}
}

func TestPublicRouteLimiter_HoldsAForgedRotatingKeyToTheRouteWideCeiling(t *testing.T) {
	limiter := newPublicRouteLimiter(2, 5, time.Hour)

	allowed := 0
	for i := 0; i < 50; i++ {
		if limiter.allow(fmt.Sprintf("203.0.113.%d", i)) {
			allowed++
		}
	}

	if allowed != 5 {
		t.Errorf("allowed %d requests, want the route-wide ceiling of 5", allowed)
	}
}

func TestPublicRouteLimiter_StillAppliesThePerClientBudget(t *testing.T) {
	limiter := newPublicRouteLimiter(2, 100, time.Hour)

	if !limiter.allow("203.0.113.5") || !limiter.allow("203.0.113.5") {
		t.Fatal("expected the first two requests to be allowed")
	}
	if limiter.allow("203.0.113.5") {
		t.Error("expected the third request from the same client to be refused")
	}
	if !limiter.allow("203.0.113.6") {
		t.Error("expected a different client to still be allowed")
	}
}

func TestPublicRouteLimiter_DoesNotSpendTheCeilingOnARefusedClient(t *testing.T) {
	limiter := newPublicRouteLimiter(1, 3, time.Hour)

	limiter.allow("203.0.113.5")
	for i := 0; i < 10; i++ {
		limiter.allow("203.0.113.5")
	}

	if !limiter.allow("203.0.113.6") || !limiter.allow("203.0.113.7") {
		t.Error("refused requests should not have drawn down the route-wide budget")
	}
	if limiter.allow("203.0.113.8") {
		t.Error("expected the route-wide ceiling to be spent by now")
	}
}
