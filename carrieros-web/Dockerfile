# Multi-stage build for ECS Express Mode. Matches ci.yml's Node 22 pin.
# next.config.ts sets output: "standalone", so the final image only needs
# .next/standalone + .next/static + public -- not the full node_modules tree.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* vars are baked into the client bundle at build time, so they
# must be real values here, not just present at container-run time. Pass them
# as build args from CI (or `docker build --build-arg ...` locally).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Server-only (no NEXT_PUBLIC_ prefix -- never baked into the client bundle, just read at request
# time by app/api/version/route.ts) so /api/version can report exactly which commit a running
# container is serving. Without this there was no way to tell "main has new commits" apart from
# "staging is actually running them" short of manually reasoning through git log and deploy history --
# the gap that let the 2026-09-27 session's fixes sit undeployed on staging without anyone noticing.
# Pass at build time: docker buildx build --build-arg BUILD_SHA=$(git rev-parse HEAD)
#   --build-arg BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) ...
ARG BUILD_SHA
ARG BUILD_TIME
ENV BUILD_SHA=$BUILD_SHA
ENV BUILD_TIME=$BUILD_TIME
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
# Port 3000, not 80: the non-root `nextjs` user can't bind to a privileged
# port (<1024) on Linux without extra capabilities. The ALB's public URL is
# unaffected -- set the ECS/Express service's container port to 3000 to match.
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
