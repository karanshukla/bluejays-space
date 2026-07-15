package main

import "net/http"

// securityHeaders sets security-relevant HTTP headers on every response.
// CORS is intentionally omitted — /.well-known/atproto-did sets its own
// Access-Control-Allow-Origin.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
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
