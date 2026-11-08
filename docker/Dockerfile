# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    IW_NO_OPEN=1 \
    TZ=Asia/Shanghai

WORKDIR /app

# gosu lets the entrypoint fix bind-mount ownership as root, then run the app
# as the unprivileged node user.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

# Install production dependencies first so rebuilds can reuse this layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# Application code. Data is mounted at /app/data and never baked into the image.
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY skill ./skill
COPY LICENSE NOTICE THIRD-PARTY.md ./
COPY docker/entrypoint.sh /usr/local/bin/iw-entrypoint

RUN mkdir -p /app/data \
    && chown -R node:node /app \
    && chmod +x /usr/local/bin/iw-entrypoint

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/local/bin/iw-entrypoint"]
CMD ["node", "server.js"]
