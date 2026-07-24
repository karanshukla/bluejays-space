// bluejays-notify — draft-queue digest job. Runs once and exits.
// Railway triggers it on a cron schedule (like classify/). Connects to the same
// Postgres as the other services, counts draft headlines waiting in the admin
// review queue, and emails NOTIFY_TO via SMTP2GO if any are present. With zero
// drafts it logs and exits 0 without sending anything, so a daily cron doesn't
// spam an empty "all clear".
package main

import (
	"bytes"
	"crypto/tls"
	"database/sql"
	"fmt"
	"html"
	"log"
	"net"
	"net/mail"
	"net/smtp"
	"os"
	"runtime/debug"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

// smtpTimeout bounds the entire SMTP exchange (dial, TLS handshake, auth,
// DATA). net/smtp has no built-in timeout, so a stalled or firewalled server
// would otherwise hang the cron run forever with nothing ever logged.
const smtpTimeout = 20 * time.Second

// mimeBoundary is fixed (not random) on purpose: RFC 2046 only requires it be
// unlikely to appear in the body, and a constant value makes the generated
// message deterministic and easy to assert against in tests.
const mimeBoundary = "bluejays-notify-1739400000"

type config struct {
	databaseURL string
	notifyTo    string
	smtpUser    string
	smtpKey     string
	smtpHost    string
	smtpPort    string
	notifyFrom  string
	siteURL     string
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func loadConfig() (config, error) {
	c := config{
		databaseURL: os.Getenv("DATABASE_URL"),
		notifyTo:    os.Getenv("NOTIFY_TO"),
		smtpUser:    os.Getenv("SMTP2GO_USERNAME"),
		smtpKey:     os.Getenv("SMTP2GO_KEY"),
		smtpHost:    envOr("SMTP2GO_HOST", "mail.smtp2go.com"),
		smtpPort:    envOr("SMTP2GO_PORT", "587"),
		notifyFrom:  envOr("NOTIFY_FROM", "bluejays.space <noreply@bluejays.space>"),
		siteURL:     envOr("SITE_URL", "https://bluejays.space"),
	}
	var missing []string
	if c.databaseURL == "" {
		missing = append(missing, "DATABASE_URL")
	}
	if c.notifyTo == "" {
		missing = append(missing, "NOTIFY_TO")
	}
	if c.smtpUser == "" {
		missing = append(missing, "SMTP2GO_USERNAME")
	}
	if c.smtpKey == "" {
		missing = append(missing, "SMTP2GO_KEY")
	}
	if len(missing) > 0 {
		return c, fmt.Errorf("missing required env: %s", strings.Join(missing, ", "))
	}
	return c, nil
}

type draft struct {
	ID           int
	Headline     string
	Source       string
	SafetyStatus sql.NullString
	CreatedAt    time.Time
}

func getDrafts(db *sql.DB) ([]draft, error) {
	rows, err := db.Query(
		`SELECT id, headline, source, safety_status, created_at
		 FROM headlines
		 WHERE status = 'draft'
		 ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var drafts []draft
	for rows.Next() {
		var d draft
		if err := rows.Scan(&d.ID, &d.Headline, &d.Source, &d.SafetyStatus, &d.CreatedAt); err != nil {
			return nil, err
		}
		drafts = append(drafts, d)
	}
	return drafts, rows.Err()
}

func adminURL(siteURL string) string {
	return strings.TrimRight(siteURL, "/") + "/admin"
}

func safetyLabel(s sql.NullString) string {
	if !s.Valid || s.String == "" {
		return "pending classify"
	}
	return s.String
}

func formatTime(t time.Time) string {
	return t.UTC().Format("2006-01-02 15:04 UTC")
}

// subjectLine pluralizes "draft" so the subject reads correctly for 1 vs many.
func subjectLine(n int) string {
	noun := "drafts"
	if n == 1 {
		noun = "draft"
	}
	return fmt.Sprintf("[bluejays.space] %d %s waiting for review", n, noun)
}

func buildTextBody(drafts []draft, adminURL string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%d draft(s) are waiting in the review queue:\n\n", len(drafts))
	for _, d := range drafts {
		fmt.Fprintf(&b, "• %s\n", d.Headline)
		fmt.Fprintf(&b, "    #%d · %s · source: %s · safety: %s\n",
			d.ID, formatTime(d.CreatedAt), d.Source, safetyLabel(d.SafetyStatus))
	}
	fmt.Fprintf(&b, "\nReview and publish at %s\n", adminURL)
	return b.String()
}

func buildHTMLBody(drafts []draft, adminURL string) string {
	var b bytes.Buffer
	b.WriteString("<div style=\"font-family:system-ui,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111;\">")
	fmt.Fprintf(&b, "<p>%d draft(s) are waiting in the review queue:</p>", len(drafts))
	b.WriteString("<ul style=\"padding-left:18px;\">")
	for _, d := range drafts {
		fmt.Fprintf(&b,
			"<li style=\"margin:8px 0;\"><strong>%s</strong><br>"+
				"<span style=\"color:#555;font-size:12px;\">#%d · %s · source: %s · safety: %s</span></li>",
			html.EscapeString(d.Headline),
			d.ID,
			html.EscapeString(formatTime(d.CreatedAt)),
			html.EscapeString(d.Source),
			html.EscapeString(safetyLabel(d.SafetyStatus)))
	}
	b.WriteString("</ul>")
	fmt.Fprintf(&b, "<p>👉 <a href=\"%s\">Review and publish in /admin</a></p>", html.EscapeString(adminURL))
	b.WriteString("</div>")
	return b.String()
}

func buildMessage(from, to, subject, siteURL string, drafts []draft) ([]byte, error) {
	// RFC 5322 requires an origin date header; use the local zone so the
	// timestamp is human-readable in the recipient's context.
	fromAddr, err := mail.ParseAddress(from)
	if err != nil {
		return nil, fmt.Errorf("invalid NOTIFY_FROM %q: %w", from, err)
	}
	toAddr, err := mail.ParseAddress(to)
	if err != nil {
		return nil, fmt.Errorf("invalid NOTIFY_TO %q: %w", to, err)
	}

	text := buildTextBody(drafts, adminURL(siteURL))
	htmlBody := buildHTMLBody(drafts, adminURL(siteURL))

	var msg bytes.Buffer
	fmt.Fprintf(&msg, "From: %s\r\n", fromAddr.String())
	fmt.Fprintf(&msg, "To: %s\r\n", toAddr.String())
	fmt.Fprintf(&msg, "Subject: %s\r\n", subject)
	fmt.Fprintf(&msg, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	msg.WriteString("MIME-Version: 1.0\r\n")
	fmt.Fprintf(&msg, "Content-Type: multipart/alternative; boundary=%q\r\n", mimeBoundary)
	msg.WriteString("\r\n")
	fmt.Fprintf(&msg, "--%s\r\n", mimeBoundary)
	msg.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	msg.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	msg.WriteString(text)
	msg.WriteString("\r\n")
	fmt.Fprintf(&msg, "--%s\r\n", mimeBoundary)
	msg.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
	msg.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	msg.WriteString(htmlBody)
	msg.WriteString("\r\n")
	fmt.Fprintf(&msg, "--%s--\r\n", mimeBoundary)
	return msg.Bytes(), nil
}

func sendMail(c config, msg []byte) error {
	fromAddr, err := mail.ParseAddress(c.notifyFrom)
	if err != nil {
		return fmt.Errorf("invalid NOTIFY_FROM %q: %w", c.notifyFrom, err)
	}
	toAddr, err := mail.ParseAddress(c.notifyTo)
	if err != nil {
		return fmt.Errorf("invalid NOTIFY_TO %q: %w", c.notifyTo, err)
	}

	addr := c.smtpHost + ":" + c.smtpPort
	conn, err := net.DialTimeout("tcp", addr, smtpTimeout)
	if err != nil {
		return fmt.Errorf("dialing %s: %w", addr, err)
	}
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(smtpTimeout)); err != nil {
		return fmt.Errorf("setting smtp connection deadline: %w", err)
	}

	client, err := smtp.NewClient(conn, c.smtpHost)
	if err != nil {
		return fmt.Errorf("creating smtp client: %w", err)
	}
	defer client.Close()

	if ok, _ := client.Extension("STARTTLS"); ok {
		if err := client.StartTLS(&tls.Config{ServerName: c.smtpHost}); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
	}

	auth := smtp.PlainAuth("", c.smtpUser, c.smtpKey, c.smtpHost)
	if err := client.Auth(auth); err != nil {
		return fmt.Errorf("smtp auth: %w", err)
	}
	if err := client.Mail(fromAddr.Address); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	if err := client.Rcpt(toAddr.Address); err != nil {
		return fmt.Errorf("smtp RCPT TO: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("writing smtp message body: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("closing smtp message writer: %w", err)
	}
	return client.Quit()
}

func run(c config) error {
	// sql.Open doesn't dial; the next query does, so a bad DATABASE_URL surfaces
	// as an error from getDrafts rather than here.
	db, err := sql.Open("postgres", c.databaseURL)
	if err != nil {
		return fmt.Errorf("opening db: %w", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	drafts, err := getDrafts(db)
	if err != nil {
		return fmt.Errorf("querying drafts: %w", err)
	}
	log.Printf("[notify] %d draft(s) in the review queue", len(drafts))
	if len(drafts) == 0 {
		return nil
	}

	msg, err := buildMessage(c.notifyFrom, c.notifyTo, subjectLine(len(drafts)), c.siteURL, drafts)
	if err != nil {
		return fmt.Errorf("building message: %w", err)
	}
	log.Printf("[notify] sending digest for %d draft(s) to %s via %s:%s", len(drafts), c.notifyTo, c.smtpHost, c.smtpPort)
	if err := sendMail(c, msg); err != nil {
		return fmt.Errorf("sending mail: %w", err)
	}
	log.Printf("[notify] sent digest to %s", c.notifyTo)
	return nil
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[notify] panic: %v\n%s", r, debug.Stack())
			os.Exit(1)
		}
	}()

	c, err := loadConfig()
	if err != nil {
		log.Printf("[notify] config error: %v", err)
		os.Exit(1)
	}

	if err := run(c); err != nil {
		log.Printf("[notify] failed: %v", err)
		os.Exit(1)
	}
	log.Println("[notify] done")
}
