package main

import (
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"
)

func TestLoadConfig_MissingVars(t *testing.T) {
	for _, k := range []string{"DATABASE_URL", "NOTIFY_TO", "SMTP2GO_USERNAME", "SMTP2GO_KEY"} {
		t.Setenv(k, "")
	}
	_, err := loadConfig()
	if err == nil {
		t.Fatal("expected error when required vars are missing, got nil")
	}
	for _, want := range []string{"DATABASE_URL", "NOTIFY_TO", "SMTP2GO_USERNAME", "SMTP2GO_KEY"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error should name %q, got: %v", want, err)
		}
	}
}

func TestLoadConfig_DefaultsApplied(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://u:p@db:5432/x")
	t.Setenv("NOTIFY_TO", "rev@example.com")
	t.Setenv("SMTP2GO_USERNAME", "user")
	t.Setenv("SMTP2GO_KEY", "secret")
	c, err := loadConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.smtpHost != "mail.smtp2go.com" {
		t.Errorf("smtpHost default = %q, want mail.smtp2go.com", c.smtpHost)
	}
	if c.smtpPort != "587" {
		t.Errorf("smtpPort default = %q, want 587", c.smtpPort)
	}
	if c.siteURL != "https://bluejays.space" {
		t.Errorf("siteURL default = %q, want https://bluejays.space", c.siteURL)
	}
}

func TestAdminURL(t *testing.T) {
	cases := map[string]string{
		"https://bluejays.space":     "https://bluejays.space/admin",
		"https://bluejays.space/":    "https://bluejays.space/admin",
		"https://bluejays.space///":  "https://bluejays.space/admin",
		"http://localhost:4321":      "http://localhost:4321/admin",
		"http://localhost:4321/web/": "http://localhost:4321/web/admin",
	}
	for in, want := range cases {
		if got := adminURL(in); got != want {
			t.Errorf("adminURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSafetyLabel(t *testing.T) {
	cases := []struct {
		in   sql.NullString
		want string
	}{
		{sql.NullString{}, "pending classify"},
		{sql.NullString{String: "", Valid: true}, "pending classify"},
		{sql.NullString{String: "safe", Valid: true}, "safe"},
		{sql.NullString{String: "review", Valid: true}, "review"},
		{sql.NullString{String: "blocked", Valid: true}, "blocked"},
	}
	for _, tc := range cases {
		if got := safetyLabel(tc.in); got != tc.want {
			t.Errorf("safetyLabel(%+v) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestSubjectLine(t *testing.T) {
	if got := subjectLine(1); !strings.Contains(got, "1 draft waiting") {
		t.Errorf("subjectLine(1) = %q, want singular 'draft'", got)
	}
	if got := subjectLine(3); !strings.Contains(got, "3 drafts waiting") {
		t.Errorf("subjectLine(3) = %q, want plural 'drafts'", got)
	}
}

func TestBuildTextBody(t *testing.T) {
	drafts := []draft{
		{
			ID: 1, Headline: "Vlad walks a dog", Source: "admin",
			SafetyStatus: sql.NullString{String: "safe", Valid: true},
			CreatedAt:    time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC),
		},
		{
			ID: 2, Headline: "<script>hi</script>", Source: "submission",
			SafetyStatus: sql.NullString{},
			CreatedAt:    time.Date(2026, 7, 24, 13, 0, 0, 0, time.UTC),
		},
	}
	body := buildTextBody(drafts, "https://bluejays.space/admin")
	if !strings.Contains(body, "2 draft(s)") {
		t.Errorf("body should contain draft count, got: %s", body)
	}
	if !strings.Contains(body, "Vlad walks a dog") {
		t.Errorf("body should contain first headline, got: %s", body)
	}
	if !strings.Contains(body, "pending classify") {
		t.Errorf("body should label unclassified draft, got: %s", body)
	}
	if !strings.Contains(body, "https://bluejays.space/admin") {
		t.Errorf("body should contain admin link, got: %s", body)
	}
}

func TestBuildHTMLBody_EscapesUnsafeContent(t *testing.T) {
	drafts := []draft{
		{ID: 1, Headline: "<script>alert(1)</script>", Source: "submission",
			SafetyStatus: sql.NullString{String: "review", Valid: true},
			CreatedAt:    time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC)},
	}
	body := buildHTMLBody(drafts, "https://bluejays.space/admin")
	if strings.Contains(body, "<script>alert(1)</script>") {
		t.Errorf("headline must be HTML-escaped, got raw <script>: %s", body)
	}
	if !strings.Contains(body, "&lt;script&gt;") {
		t.Errorf("headline should be escaped to &lt;script&gt;, got: %s", body)
	}
}

func TestBuildMessage_IsValidMultipartAndParseable(t *testing.T) {
	drafts := []draft{
		{ID: 1, Headline: "Test headline", Source: "admin",
			SafetyStatus: sql.NullString{String: "safe", Valid: true},
			CreatedAt:    time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC)},
	}
	msg, err := buildMessage("Karan <noreply@bluejays.space>", "Karan <rev@example.com>",
		subjectLine(1), "https://bluejays.space", drafts)
	if err != nil {
		t.Fatalf("buildMessage: %v", err)
	}
	s := string(msg)
	for _, want := range []string{
		`From: "Karan" <noreply@bluejays.space>`,
		`To: "Karan" <rev@example.com>`,
		"Subject: [bluejays.space] 1 draft waiting for review",
		"Date:",
		"MIME-Version: 1.0",
		"Content-Type: multipart/alternative; boundary=",
		"--" + mimeBoundary,
		"--" + mimeBoundary + "--",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("message missing %q", want)
		}
	}
	// Closing boundary must be the last non-whitespace line.
	trimmed := strings.TrimRight(s, " \r\n")
	if !strings.HasSuffix(trimmed, "--"+mimeBoundary+"--") {
		t.Errorf("message should end with closing boundary")
	}
}

func TestBuildMessage_RejectsBadAddress(t *testing.T) {
	_, err := buildMessage("not-an-address", "rev@example.com", "s", "https://bluejays.space", []draft{{ID: 1}})
	if err == nil {
		t.Error("expected error for malformed From address")
	}
}

// Ensures the env vars we clear in TestLoadConfig_MissingVars don't bleed into
// other tests via os.Environ when run with -shuffle.
func TestMain(m *testing.M) {
	os.Exit(m.Run())
}
