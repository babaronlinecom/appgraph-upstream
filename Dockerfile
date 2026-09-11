# syntax=docker/dockerfile:1

# ---------- dependencies ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- build ----------
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_STANDALONE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S appgraph && adduser -S appgraph -G appgraph
COPY --from=builder /app/public ./public
COPY --from=builder --chown=appgraph:appgraph /app/.next/standalone ./
COPY --from=builder --chown=appgraph:appgraph /app/.next/static ./.next/static
RUN mkdir -p /app/.appgraph-cache && chown -R appgraph:appgraph /app/.appgraph-cache
USER appgraph
EXPOSE 3000
CMD ["node", "server.js"]
