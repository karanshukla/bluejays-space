# Production image for bluejays-notify (Go cron job).
# Railway builds this from notify/ (set the service's root directory to notify/)
# and runs it on a cron trigger. Runs once and exits: counts draft headlines in
# the admin review queue and emails NOTIFY_TO via SMTP2GO if any are present.
FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -o notify .

FROM alpine:3.24
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/notify .
RUN adduser -D -u 10001 app \
 && chown -R app:app /app
USER app
CMD ["./notify"]
