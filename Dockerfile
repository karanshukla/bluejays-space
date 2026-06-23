FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY *.go ./
RUN go build -o server .

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/server .
COPY handles.json .
ENV HANDLES_FILE=handles.json
EXPOSE 8080
CMD ["./server"]
