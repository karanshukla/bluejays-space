package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
)

// handles maps subdomain username -> AT Protocol DID.
// Loaded from handles.json at startup; update via PR and redeploy.
var handles map[string]string

func main() {
	port := envOr("PORT", "8080")
	baseDomain := envOr("BASE_DOMAIN", "bluejays.space")
	configPath := envOr("HANDLES_FILE", "handles.json")

	b, err := os.ReadFile(configPath)
	if err != nil {
		log.Fatalf("could not read %s: %v", configPath, err)
	}
	if err := json.Unmarshal(b, &handles); err != nil {
		log.Fatalf("could not parse %s: %v", configPath, err)
	}
	log.Printf("loaded %d handle(s) from %s", len(handles), configPath)

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

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, homePage, baseDomain)
	})

	log.Printf("listening on :%s for %s", port, baseDomain)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

const homePage = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>%[1]s — Bluesky Handles</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    background: #0a0a0f;
    color: #e8e8f0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: #13131a;
    border: 1px solid #1e1e2e;
    border-radius: 16px;
    padding: 48px;
    max-width: 520px;
    width: 100%%;
  }
  h1 { font-size: 1.5rem; font-weight: 700; color: #fff; margin-bottom: 8px; }
  p { color: #7070a0; font-size: 0.95rem; line-height: 1.6; margin-bottom: 16px; }
  .accent { color: #4a4aff; }
  hr { border: none; border-top: 1px solid #1e1e2e; margin: 28px 0; }
  ol { padding-left: 0; list-style: none; counter-reset: steps; }
  li {
    counter-increment: steps;
    display: flex;
    gap: 14px;
    align-items: flex-start;
    margin-bottom: 14px;
    font-size: 0.9rem;
    color: #b0b0d0;
    line-height: 1.5;
  }
  li::before {
    content: counter(steps);
    background: #1e1e2e;
    color: #7070a0;
    width: 22px;
    height: 22px;
    border-radius: 50%%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
    flex-shrink: 0;
    margin-top: 1px;
  }
  code { background: #1e1e2e; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; color: #c8c8f0; }
</style>
</head>
<body>
<div class="card">
  <h1>%[1]s</h1>
  <p>Custom Bluesky handles on <span class="accent">%[1]s</span> — invite only.</p>
  <hr>
  <p>Once you've been added, verify your handle in Bluesky:</p>
  <ol>
    <li>Go to <strong>Settings → Change handle → I have my own domain</strong>.</li>
    <li>Enter your handle: <code>you.%[1]s</code></li>
    <li>Click <strong>Verify DNS Record</strong> — it should pass immediately.</li>
  </ol>
</div>
</body>
</html>
`
