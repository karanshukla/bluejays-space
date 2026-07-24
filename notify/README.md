# bluejays-notify

A Go microservice that runs **once and exits** — Railway triggers it on a cron
schedule (the same pattern as `../classify`). It connects to the same Postgres
as the rest of the stack, counts draft headlines waiting in the `/admin` review
queue, and emails a reviewer via **SMTP2GO** when any are present. With zero
drafts it logs and exits without sending anything, so a daily cron doesn't spam
an empty "all clear".

The email body is a `multipart/alternative` (plain text + light HTML) listing
each draft's headline, id, created date, source (`admin` vs `submission`), and
safety verdict (`safe` / `review` / `blocked` / pending classify), plus a link
to `/admin`.

## Environment variables

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | Postgres connection string (same as `web` / `classify`) |
| `NOTIFY_TO` | yes | — | Recipient email address |
| `SMTP2GO_USERNAME` | yes | — | SMTP2GO SMTP username |
| `SMTP2GO_KEY` | yes | — | SMTP2GO SMTP password / API key |
| `SMTP2GO_HOST` | no | `mail.smtp2go.com` | SMTP host |
| `SMTP2GO_PORT` | no | `587` | SMTP port (STARTTLS; `smtp.SendMail` auto-upgrades) |
| `NOTIFY_FROM` | no | `bluejays.space <noreply@bluejays.space>` | Sender — must be a SMTP2GO-verified sender domain/address |
| `SITE_URL` | no | `https://bluejays.space` | Builds the `/admin` link (reuses `web`'s var) |

If any required var is missing, the run logs an error and exits non-zero so
Railway marks the cron run failed.

## Run locally

The service isn't in `docker compose up` by default — it's under the `manual`
profile, like `classify`:

```bash
# one-shot run against the local dev stack
docker compose run --rm notify
```

To build and run the image standalone:

```bash
docker build -t bluejays-notify .
docker run --rm --network bluejays-space_default \
  -e DATABASE_URL=postgres://bluejays:bluejays@db:5432/bluejays \
  -e NOTIFY_TO=you@example.com \
  -e SMTP2GO_USERNAME=... -e SMTP2GO_KEY=... \
  bluejays-notify
```

## Deploy on Railway as a cron job

1. **New Service → GitHub Repo**, set the service's **Root Directory** to
   `notify/`. Railway builds `Dockerfile`.
2. **Variables** → add the env vars above. `DATABASE_URL` can reference the
   existing Postgres service via a reference variable
   (`${{Postgres.DATABASE_URL}}`).
3. **Settings → Cron Schedule** — set a schedule (e.g. `0 9 * * *` for 09:00
   daily UTC). The command is the image default (`./notify`); it runs once and
   exits, which is what Railway expects of a cron job.

## Development

```bash
go vet ./... && go test -race -v ./... && go build ./...
```
