package main

import "net/http"

// securityHeaders wraps a handler and sets security-relevant HTTP headers on
// every response. CORS is intentionally omitted here — the only endpoint that
// needs it (/.well-known/atproto-did) sets its own Access-Control-Allow-Origin.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		// Prevent MIME-type sniffing.
		h.Set("X-Content-Type-Options", "nosniff")
		// Deny framing (belt-and-suspenders with frame-ancestors in CSP).
		h.Set("X-Frame-Options", "DENY")
		// Limit referrer information on cross-origin navigations.
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		// Disable browser features the site doesn't use.
		h.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		// CSP: no external resources; inline scripts/styles needed for the homepage.
		// img-src 'self' covers /static/* assets; connect-src 'self' covers the /status polling fetch.
		h.Set("Content-Security-Policy",
			"default-src 'none'; "+
				"script-src 'unsafe-inline'; "+
				"style-src 'unsafe-inline'; "+
				"img-src 'self'; "+
				"connect-src 'self'; "+
				"form-action 'self'; "+
				"frame-ancestors 'none'; "+
				"base-uri 'none'")
		next.ServeHTTP(w, r)
	})
}
