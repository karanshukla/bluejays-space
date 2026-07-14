# Production image for the bluejays-web Astro SSR app.
# Railway builds this from web/ (set the service's root directory to web/).
#
# Local dev (docker-compose) targets the `builder` stage — it needs the full
# devDependencies (tailwind, @astrojs/check, etc.) to run `astro build` /
# `astro preview` live against bind-mounted source. Railway's production
# build uses no explicit target, so it gets the final `runtime` stage below,
# which does its own clean `--omit=dev` install rather than inheriting
# devDependencies from the builder.
FROM node:26-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
COPY --from=builder /app/package.json /app/package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER node
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --spider -q http://127.0.0.1:${PORT:-4321}/ || exit 1
CMD ["node", "./dist/server/entry.mjs"]
