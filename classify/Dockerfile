# Production image for bluejays-classify (Node cron job).
# Railway builds this from classify/ (set the service's root directory to classify/)
# and runs it on a cron trigger. Runs once and exits: classifies unclassified
# draft headlines (text + image via Claude vision) and writes the verdict back.
FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY src ./src
USER node
CMD ["node", "src/index.js"]
