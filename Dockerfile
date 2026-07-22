# syntax=docker/dockerfile:1

########################
# Stage 1: Dependencies
########################
FROM node:22-alpine AS deps
WORKDIR /app

# Needed by some native modules (bcryptjs is pure JS, but pg/prisma may need this)
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json* ./
COPY prisma ./prisma

# Install all deps (including dev, needed for build) with clean, reproducible install
RUN npm ci

########################
# Stage 2: Build
########################
FROM node:22-alpine AS build
WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client and build Nest app
# DATABASE_URL is required by prisma.config.ts Zod validation at build time.
# A dummy value is safe here — prisma generate only reads the schema, not the DB.
RUN DATABASE_URL="postgres://61b9a83c7c529d252b77cef95674183af888ceb311826f46f56568ce2d2f5fa7:sk_Iw4tq_5K2RRWpZdp2oWAL@pooled.db.prisma.io:5432/postgres?sslmode=require" npx prisma generate
RUN npm run build

# Remove dev dependencies, keep only production node_modules
RUN npm prune --omit=dev

########################
# Stage 3: Production runtime
########################
FROM node:22-alpine AS production
WORKDIR /app

RUN apk add --no-cache openssl dumb-init \
    && addgroup -S nodejs -g 1001 \
    && adduser -S nestjs -u 1001

ENV NODE_ENV=production

COPY --from=build --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --from=build --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nestjs:nodejs /app/package.json ./package.json

# If you have ejs templates or other runtime assets outside src, copy them too, e.g.:
# COPY --from=build --chown=nestjs:nodejs /app/src/templates ./dist/templates
RUN mkdir -p /app/uploads && chown -R nestjs:nodejs /app/uploads
USER nestjs

EXPOSE 5000

# dumb-init ensures proper signal handling (SIGTERM) for graceful shutdown
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/src/main"]
