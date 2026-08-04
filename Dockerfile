# Build once, run anywhere the home server can reach the site.
# The output is a single bundled file on a distroless-ish base, so the runtime
# image carries no package manager, no node_modules, and no source.

FROM oven/bun:1.3-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN bun build src/index.ts --target=node --outdir=dist --minify

FROM node:24-alpine AS runtime
WORKDIR /app
COPY --from=build /app/dist/index.js ./index.js

# Runs as a non-root user; the server needs no filesystem access at all.
USER node

# MCP over stdio: run with `docker run -i --rm` so stdin stays attached.
ENTRYPOINT ["node", "/app/index.js"]
