FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY *.go ./
COPY templates/ ./templates/
COPY static/ ./static/
RUN go build -o server .

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/server .
COPY handles.json .
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
 && adduser -D -u 10001 app \
 && chown -R app:app /app
USER app
ENV HANDLES_FILE=handles.json
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --spider -q http://127.0.0.1:${PORT:-8080}/ || exit 1
ENTRYPOINT ["/entrypoint.sh"]
CMD ["./server"]
