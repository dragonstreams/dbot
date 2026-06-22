# syntax=docker/dockerfile:1.7
#
# Production Dockerfile for @workspace/discord-bot
#
# Multi-arch supported (linux/amd64, linux/arm64+).
# For bunny.net (amd64 only): use --platform linux/amd64
#
# Build & push examples:
#   # Single arch (e.g. for bunny.net)
#   docker build --platform linux/amd64 -t ghcr.io/dragonstreams/dbot:latest .
#
#   # Multi-arch (recommended for GHCR)
#   docker buildx create --use
#   docker buildx build \
#     --platform linux/amd64,linux/arm64 \
#     -t ghcr.io/dragonstreams/dbot:latest \
#     -t ghcr.io/dragonstreams/dbot:v1 \
#     --push .
#   docker push ghcr.io/dragonstreams/dbot:latest

FROM node:24-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ==========================================
# Builder: install + compile
# ==========================================
FROM base AS builder
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# Copy all workspace package.json files so pnpm can resolve the full monorepo
# (required for frozen-lockfile + onlyBuiltDependencies + catalog resolution)
COPY artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY artifacts/discord-bot/package.json ./artifacts/discord-bot/package.json
COPY artifacts/jellyfin-addon/package.json ./artifacts/jellyfin-addon/package.json
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/package.json
COPY lib/api-client-react/package.json ./lib/api-client-react/package.json
COPY lib/api-spec/package.json ./lib/api-spec/package.json
COPY lib/api-zod/package.json ./lib/api-zod/package.json
COPY lib/db/package.json ./lib/db/package.json
COPY scripts/package.json ./scripts/package.json

# Use --ignore-scripts to bypass ERR_PNPM_IGNORED_BUILDS for esbuild etc.
# (The onlyBuiltDependencies list + pnpm approve-builds do not reliably suppress
# the error under corepack in the Docker build env.) This is safe here because
# we only compile the discord-bot with tsc; no packages that require their
# postinstall build scripts (esbuild, swc, etc) are executed.
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# Compile using the new "build" script
RUN pnpm --filter @workspace/discord-bot run build

# Create pruned production deployment (prod deps only)
RUN pnpm --filter @workspace/discord-bot deploy --prod --legacy /prod/discord-bot

# Copy compiled output into the deploy folder
RUN cp -r /app/artifacts/discord-bot/dist /prod/discord-bot/dist

# ==========================================
# Final minimal runtime image
# ==========================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /prod/discord-bot ./

CMD ["node", "dist/index.js"]
