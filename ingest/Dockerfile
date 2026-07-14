# Production image for bluejays-ingest (Node cron job).
# Railway builds this from ingest/ (set the service's root directory to ingest/)
# and runs it on a cron trigger. Runs once and exits.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src ./src
USER node
CMD ["node", "src/index.js"]
