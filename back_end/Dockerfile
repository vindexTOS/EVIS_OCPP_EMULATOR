# ---- Base ----
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---- Dependencies ----
# Cached separately so installs only re-run when manifests change.
FROM base AS deps
# better-sqlite3 ships prebuilt binaries; the compiler is only a fallback for
# platforms it has none for.
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- Development ----
# Used by docker-compose.dev.yml. Source is bind-mounted, so `start:dev`
# hot-reloads on changes.
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["pnpm", "run", "start:dev"]

# ---- Build ----
FROM deps AS build
COPY . .
RUN pnpm run build && pnpm prune --prod

# ---- Production ----
FROM base AS production
ENV NODE_ENV=production
ENV SQLITE_PATH=/app/data/emulator.sqlite
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
VOLUME /app/data
EXPOSE 3000
CMD ["node", "dist/main"]
