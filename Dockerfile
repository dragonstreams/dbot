# syntax=docker/dockerfile:1.7
#
# Production Dockerfile for @workspace/discord-bot
# Optimized for bunny.net Magic Containers (linux/amd64)
#
# Build & push example:
#   docker build --platform linux/amd64 -t ghcr.io/YOUR_USERNAME/dbot:latest .
#   docker push ghcr.io/YOUR_USERNAME/dbot:latest

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
COPY artifacts/discord-bot/package.json ./artifacts/discord-bot/package.json

RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

# Compile using the new "build" script
RUN pnpm --filter @workspace/discord-bot run build

# Create pruned production deployment (prod deps only)
RUN pnpm --filter @workspace/discord-bot deploy --prod /prod/discord-bot

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
