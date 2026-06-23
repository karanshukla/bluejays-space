FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY *.go ./
COPY templates/ ./templates/
COPY static/ ./static/
RUN go build -o server .

FROM alpine:3.21
WORKDIR /app
COPY --from=builder /app/server .
COPY handles.json .
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV HANDLES_FILE=handles.json
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
CMD ["./server"]
