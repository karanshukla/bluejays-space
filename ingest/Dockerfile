# Production image for bluejays-ingest (Node cron job).
# Railway builds this from ingest/ (set the service's root directory to ingest/)
# and runs it on a cron trigger. Runs once and exits.
#
# Single stage: the stub has no dependencies yet. When deps are added, split
# into a builder (npm ci) + runtime like web/Dockerfile.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY src ./src
USER node
CMD ["node", "src/index.js"]
