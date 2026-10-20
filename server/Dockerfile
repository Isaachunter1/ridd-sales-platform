# One image for HTTP endpoints and scheduled jobs. Pin by digest later
# (docs/ARCHITECTURE.md → "Pinned toolchain"); tag is fine for the POC.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Install first, copy source second — the install layer caches between deploys.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev --no-audit --no-fund

COPY . .

# Cloud Run sets PORT; config/env.js defaults it to 8080 anyway.
EXPOSE 8080
USER node
CMD ["node", "index.js"]
