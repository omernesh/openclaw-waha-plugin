# Phase 59-02 (CORE-04, CORE-06): Multi-stage Docker build for Chatlytics standalone server.
#
# Stage 1 (builder): Installs all deps + runs Vite admin panel build.
# Stage 2 (runtime): Copies src/ + built admin panel, installs prod deps + tsx, runs standalone.ts.
#
# node:22-slim (not alpine): better-sqlite3 native bindings require glibc.
# curl installed for HEALTHCHECK probe — not included in node:22-slim base.
# USER node: non-root execution for security.
# CHATLYTICS_DATA_DIR=/data: Docker named volume mounts here for SQLite persistence.
#
# DO NOT CHANGE base image to alpine — better-sqlite3 will fail to build.
# DO NOT REMOVE curl install — HEALTHCHECK depends on it.
# DO NOT REMOVE USER node — required for non-root security posture.

# ---------------------------------------------------------------------------
# Stage 1: Build admin panel (Vite)
# ---------------------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build:admin

# ---------------------------------------------------------------------------
# Stage 2: Runtime
# ---------------------------------------------------------------------------
FROM node:22-slim

# curl is required for the HEALTHCHECK CMD below.
# DO NOT REMOVE — container will be permanently unhealthy without it.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production dependencies + tsx runtime (not in devDependencies).
COPY package*.json ./
RUN npm ci --omit=dev && npm install tsx

# Copy source files loaded by tsx (jiti not used in standalone mode).
COPY src/ ./src/
COPY index.ts ./
COPY SKILL.md ./
COPY config-example.json ./

# Copy Vite-built admin panel from builder stage.
COPY --from=builder /app/dist/admin/ ./dist/admin/

# Create default data directory; assign ownership to the node user.
# Docker named volume will be mounted here (see docker-compose.yml).
# DO NOT CHANGE path — matches ENV CHATLYTICS_DATA_DIR below.
RUN mkdir -p /data && chown node:node /data

# Run as non-root user for security.
# DO NOT REMOVE — required security posture.
USER node

ENV NODE_ENV=production
# CHATLYTICS_DATA_DIR: SQLite databases land here → bind to Docker named volume.
# DO NOT CHANGE — data-dir.ts reads this env var for all DB singletons.
ENV CHATLYTICS_DATA_DIR=/data

EXPOSE 8050

# Health check: probe the /health endpoint every 10s.
# --start-period=30s gives the server time to connect to WAHA on startup.
# Probes the liveness route (/healthz) which returns plain "ok" without auth.
# DO NOT CHANGE to /health — /health may require auth in future; /healthz is always public.
HEALTHCHECK --interval=10s --timeout=5s --retries=6 --start-period=30s \
  CMD curl -f http://localhost:8050/healthz || exit 1

# Entry point: tsx runs standalone.ts directly (no compile step needed).
# DO NOT CHANGE — standalone.ts is the Docker entrypoint per Phase 59-01.
CMD ["npx", "tsx", "src/standalone.ts"]
