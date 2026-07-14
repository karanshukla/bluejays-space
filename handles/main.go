package main

import (
	"bytes"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

//go:embed templates/index.html
var templateFS embed.FS

//go:embed static
var staticFS embed.FS

type jobResult struct {
	PRURL   string
	ErrMsg  string
	Done    bool
	created time.Time
}

var handles map[string]string

func main() {
	port := envOr("PORT", "8080")
	baseDomain := envOr("BASE_DOMAIN", "bluejays.space")
	configPath := envOr("HANDLES_FILE", "handles.json")
	githubToken := os.Getenv("GITHUB_TOKEN")
	githubRepo := envOr("GITHUB_REPO", "karanshukla/bluejays-space")

	var err error
	handles, err = loadHandles(configPath)
	if err != nil {
		log.Fatalf("could not load %s: %v", configPath, err)
	}
	warnDuplicateDIDs(handles, log.Printf)
	log.Printf("loaded %d handle(s) from %s", len(handles), configPath)

	limiter := newRateLimiter(5, time.Hour)

	var jobsMu sync.Mutex
	jobs := make(map[string]jobResult)

	// Prune stale jobs every 5 minutes.
	go func() {
		for range time.Tick(5 * time.Minute) {
			cutoff := time.Now().Add(-10 * time.Minute)
			jobsMu.Lock()
			for id, j := range jobs {
				if j.created.Before(cutoff) {
					delete(jobs, id)
				}
			}
			jobsMu.Unlock()
		}
	}()

	mux := http.NewServeMux()

	// AT Protocol handle verification.
	// Bluesky GETs https://<username>.bluejays.space/.well-known/atproto-did
	// and expects the plain-text DID in the response.
	mux.HandleFunc("/.well-known/atproto-did", func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if i := strings.LastIndex(host, ":"); i >= 0 {
			host = host[:i]
		}
		username := strings.ToLower(strings.TrimSuffix(host, "."+baseDomain))
		if username == strings.ToLower(host) {
			http.NotFound(w, r)
			return
		}
		did, ok := handles[username]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		fmt.Fprint(w, did)
	})

	// Async job status - polled by the spinner page.
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("job")
		jobsMu.Lock()
		j, ok := jobs[id]
		jobsMu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		if !ok {
			// Expired or invalid - stop polling with a generic message.
			json.NewEncoder(w).Encode(map[string]interface{}{
				"done":  true,
				"error": "Status unavailable. Check GitHub for your pull request.",
			})
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"done":   j.Done,
			"pr_url": j.PRURL,
			"error":  j.ErrMsg,
		})
	})

	mux.HandleFunc("/request-handle", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !limiter.allow(clientIP(r)) {
			http.Redirect(w, r, "/?error=rate-limited", http.StatusSeeOther)
			return
		}
		if githubToken == "" {
			http.Redirect(w, r, "/?error=not-configured", http.StatusSeeOther)
			return
		}

		// Cap body size to prevent large payload abuse.
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		if err := r.ParseForm(); err != nil {
			http.Redirect(w, r, "/?error=server-error", http.StatusSeeOther)
			return
		}

		handle := strings.ToLower(strings.TrimSpace(r.FormValue("handle")))
		did := strings.TrimSpace(r.FormValue("did"))

		if !isValidHandle(handle) {
			http.Redirect(w, r, "/?error=invalid-handle", http.StatusSeeOther)
			return
		}
		if !isValidDID(did) {
			http.Redirect(w, r, "/?error=invalid-did", http.StatusSeeOther)
			return
		}
		// Fast-path checks against the in-memory map before touching GitHub.
		if _, taken := handles[handle]; taken {
			http.Redirect(w, r, "/?error=handle-taken", http.StatusSeeOther)
			return
		}

		jobID := newJobID()
		jobsMu.Lock()
		jobs[jobID] = jobResult{created: time.Now()}
		jobsMu.Unlock()

		go func() {
			prURL, err := createHandlePR(githubToken, githubRepo, handle, did, baseDomain)
			result := jobResult{Done: true, PRURL: prURL, created: time.Now()}
			if err != nil {
				log.Printf("PR creation failed for %s: %v", handle, err)
				switch {
				case strings.Contains(err.Error(), "already taken"):
					result.ErrMsg = "That handle is already taken. Please choose a different one."
				default:
					result.ErrMsg = "Something went wrong creating the pull request. Please try again."
				}
			}
			jobsMu.Lock()
			jobs[jobID] = result
			jobsMu.Unlock()
		}()

		http.Redirect(w, r, "/?job="+jobID+"&handle="+handle, http.StatusSeeOther)
	})

	mux.Handle("/static/", http.FileServer(http.FS(staticFS)))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}

		var flash string
		if jobID := r.URL.Query().Get("job"); jobID != "" {
			handle := r.URL.Query().Get("handle")
			if !isValidHandle(handle) {
				handle = "your-handle"
			}
			// Allow only hex chars in jobID before embedding in JS.
			safeID := filterHex(jobID)
			flash = fmt.Sprintf(
				`<div class="notice processing" id="js-notice"><span class="spinner"></span> Opening pull request for <strong>@%s.%s</strong>&hellip;</div>`+
					`<script>(function(){`+
					`var t=setInterval(function(){`+
					`fetch('/status?job=%s')`+
					`.then(function(r){return r.json()})`+
					`.then(function(d){`+
					`if(!d.done)return;`+
					`clearInterval(t);`+
					`var n=document.getElementById('js-notice');`+
					`if(d.error){n.className='notice error';n.textContent=d.error}`+
					`else{n.className='notice success';n.innerHTML=`+
					`'Request for <strong>@%s.%s</strong> submitted. '`+
					`+'<a href="'+d.pr_url+'" style="color:inherit;text-decoration:underline">View pull request →</a>'}`+
					`})`+
					`.catch(function(){clearInterval(t)})`+
					`},1000)`+
					`})()`+
					`</script>`,
				handle, baseDomain, safeID, handle, baseDomain,
			)
		} else if errCode := r.URL.Query().Get("error"); errCode != "" {
			switch errCode {
			case "handle-taken":
				flash = `<div class="notice error">That handle is already taken. Please choose a different one.</div>`
			case "invalid-handle":
				flash = `<div class="notice error">Invalid handle. Use only lowercase letters, numbers, and hyphens.</div>`
			case "invalid-did":
				flash = `<div class="notice error">Invalid DID - it must start with <code>did:plc:</code> or <code>did:web:</code>.</div>`
			case "rate-limited":
				flash = `<div class="notice error">Too many requests. Please try again later.</div>`
			case "not-configured":
				flash = `<div class="notice error">Handle requests are not available right now.</div>`
			default:
				flash = `<div class="notice error">Something went wrong. Please try again.</div>`
			}
		}

		tmpl, err := template.ParseFS(templateFS, "templates/index.html")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		tmpl.Execute(w, struct {
			D     string
			Flash template.HTML
		}{baseDomain, template.HTML(flash)})
	})

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      securityHeaders(mux),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
	log.Printf("listening on :%s for %s", port, baseDomain)
	log.Fatal(srv.ListenAndServe())
}

func newJobID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// filterHex strips any non-hex characters - used before embedding a job ID in JS.
func filterHex(s string) string {
	var out strings.Builder
	for _, c := range s {
		if (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') {
			out.WriteRune(c)
		}
	}
	return out.String()
}

// isValidHandle accepts lowercase letters, digits, and interior hyphens, max 30 chars.
func isValidHandle(s string) bool {
	if len(s) == 0 || len(s) > 30 {
		return false
	}
	for _, c := range s {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
			return false
		}
	}
	return s[0] != '-' && s[len(s)-1] != '-'
}

// isValidDID accepts did:plc: and did:web: DIDs with only printable non-space ASCII.
func isValidDID(s string) bool {
	if len(s) == 0 || len(s) > 512 {
		return false
	}
	if !strings.HasPrefix(s, "did:plc:") && !strings.HasPrefix(s, "did:web:") {
		return false
	}
	// Reject anything outside printable non-space ASCII to prevent injection.
	for _, c := range s {
		if c < 33 || c > 126 {
			return false
		}
	}
	return true
}

// clientIP returns the real client IP, honouring the Cloudflare header when present.
func clientIP(r *http.Request) string {
	if ip := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); ip != "" {
		return ip
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}

// rateLimiter is an in-memory sliding-window rate limiter keyed by string (IP).
type rateLimiter struct {
	mu      sync.Mutex
	entries map[string][]time.Time
	limit   int
	window  time.Duration
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	rl := &rateLimiter{
		entries: make(map[string][]time.Time),
		limit:   limit,
		window:  window,
	}
	go rl.cleanup()
	return rl
}

func (rl *rateLimiter) allow(key string) bool {
	now := time.Now()
	cutoff := now.Add(-rl.window)
	rl.mu.Lock()
	defer rl.mu.Unlock()
	times := rl.entries[key]
	n := 0
	for _, t := range times {
		if t.After(cutoff) {
			times[n] = t
			n++
		}
	}
	times = times[:n]
	if n >= rl.limit {
		rl.entries[key] = times
		return false
	}
	rl.entries[key] = append(times, now)
	return true
}

// cleanup removes expired entries every 10 minutes to bound memory use.
func (rl *rateLimiter) cleanup() {
	for range time.Tick(10 * time.Minute) {
		cutoff := time.Now().Add(-rl.window)
		rl.mu.Lock()
		for key, times := range rl.entries {
			n := 0
			for _, t := range times {
				if t.After(cutoff) {
					times[n] = t
					n++
				}
			}
			if n == 0 {
				delete(rl.entries, key)
			} else {
				rl.entries[key] = times[:n]
			}
		}
		rl.mu.Unlock()
	}
}

type ghFileContent struct {
	Content string `json:"content"`
	SHA     string `json:"sha"`
}

type ghRef struct {
	Object struct {
		SHA string `json:"sha"`
	} `json:"object"`
}

func ghRequest(token, method, url string, body interface{}) (*http.Response, error) {
	var b []byte
	if body != nil {
		var err error
		b, err = json.Marshal(body)
		if err != nil {
			return nil, err
		}
	}
	req, err := http.NewRequest(method, url, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	return http.DefaultClient.Do(req)
}

func createHandlePR(token, repo, handle, did, baseDomain string) (string, error) {
	apiBase := "https://api.github.com/repos/" + repo

	// Get current handles.json content and blob SHA.
	resp, err := ghRequest(token, "GET", apiBase+"/contents/handles/handles.json", nil)
	if err != nil {
		return "", fmt.Errorf("get file: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("get file: status %d", resp.StatusCode)
	}
	var fc ghFileContent
	if err := json.NewDecoder(resp.Body).Decode(&fc); err != nil {
		return "", fmt.Errorf("decode file: %w", err)
	}

	// Decode content and add the new handle.
	raw, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(fc.Content, "\n", ""))
	if err != nil {
		return "", fmt.Errorf("decode base64: %w", err)
	}
	var existing map[string]string
	if err := json.Unmarshal(raw, &existing); err != nil {
		return "", fmt.Errorf("unmarshal: %w", err)
	}
	if _, ok := existing[handle]; ok {
		return "", fmt.Errorf("handle %q is already taken", handle)
	}
	// Remove any old handle entry for this DID (rename flow).
	var oldHandle string
	for h, d := range existing {
		if d == did && h != handle {
			delete(existing, h)
			oldHandle = h
			break
		}
	}
	existing[handle] = did
	_ = oldHandle
	updated, err := json.MarshalIndent(existing, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal: %w", err)
	}
	updated = append(updated, '\n')

	// Get the SHA of the main branch HEAD.
	resp2, err := ghRequest(token, "GET", apiBase+"/git/refs/heads/main", nil)
	if err != nil {
		return "", fmt.Errorf("get main ref: %w", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != 200 {
		return "", fmt.Errorf("get main ref: status %d", resp2.StatusCode)
	}
	var mainRef ghRef
	if err := json.NewDecoder(resp2.Body).Decode(&mainRef); err != nil {
		return "", fmt.Errorf("decode main ref: %w", err)
	}

	// Create a new branch off main.
	branch := "handle-request/" + handle
	resp3, err := ghRequest(token, "POST", apiBase+"/git/refs", map[string]string{
		"ref": "refs/heads/" + branch,
		"sha": mainRef.Object.SHA,
	})
	if err != nil {
		return "", fmt.Errorf("create branch: %w", err)
	}
	resp3.Body.Close()
	if resp3.StatusCode != 201 {
		return "", fmt.Errorf("create branch: status %d", resp3.StatusCode)
	}

	// Commit the updated handles.json to the new branch.
	resp4, err := ghRequest(token, "PUT", apiBase+"/contents/handles/handles.json", map[string]interface{}{
		"message": func() string {
			if oldHandle != "" {
				return "Rename handle: " + oldHandle + " → " + handle
			}
			return "Add handle: " + handle
		}(),
		"content": base64.StdEncoding.EncodeToString(updated),
		"sha":     fc.SHA,
		"branch":  branch,
	})
	if err != nil {
		return "", fmt.Errorf("update file: %w", err)
	}
	resp4.Body.Close()
	if resp4.StatusCode != 200 {
		return "", fmt.Errorf("update file: status %d", resp4.StatusCode)
	}

	// Open the pull request and return its URL.
	var prTitle, prBody string
	if oldHandle != "" {
		prTitle = "Rename handle: " + oldHandle + " → " + handle
		prBody = fmt.Sprintf("Rename `@%s.%s` → `@%s.%s`\n\nDID: `%s`\nBluesky profile: https://bsky.app/profile/%s\n\n---\n_Auto-generated by the handle request form._", oldHandle, baseDomain, handle, baseDomain, did, did)
	} else {
		prTitle = "Add handle: " + handle
		prBody = fmt.Sprintf("Requested handle `@%s.%s`\n\nDID: `%s`\nBluesky profile: https://bsky.app/profile/%s\n\n---\n_Auto-generated by the handle request form._", handle, baseDomain, did, did)
	}
	resp5, err := ghRequest(token, "POST", apiBase+"/pulls", map[string]interface{}{
		"title": prTitle,
		"body":  prBody,
		"head":  branch,
		"base":  "main",
	})
	if err != nil {
		return "", fmt.Errorf("create PR: %w", err)
	}
	defer resp5.Body.Close()
	if resp5.StatusCode != 201 {
		return "", fmt.Errorf("create PR: status %d", resp5.StatusCode)
	}
	var pr struct {
		HTMLURL string `json:"html_url"`
	}
	if err := json.NewDecoder(resp5.Body).Decode(&pr); err != nil {
		return "", fmt.Errorf("decode PR: %w", err)
	}
	return pr.HTMLURL, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
